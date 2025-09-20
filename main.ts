import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { GoogleGenAI } from "npm:@google/genai";

/**
 * 辅助函数：生成一个标准格式的 JSON 错误响应
 */
function createJsonErrorResponse(message: string, statusCode = 500, statusText = "INTERNAL") {
    const errorPayload = {
        error: { 
            code: statusCode, 
            message: message, 
            status: statusText 
        },
    };
    console.error("Replying with error:", JSON.stringify(errorPayload, null, 2));
    return new Response(JSON.stringify(errorPayload), {
        status: statusCode, 
        headers: { 
            "Content-Type": "application/json", 
            "Access-Control-Allow-Origin": "*" 
        }
    });
}

/**
 * 主服务逻辑
 */
serve(async (req) => {
    const pathname = new URL(req.url).pathname;

    if (req.method === 'OPTIONS') {
        return new Response(null, { 
            status: 204, 
            headers: { 
                "Access-Control-Allow-Origin": "*", 
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS", 
                "Access-Control-Allow-Headers": "Content-Type, Authorization, x-goog-api-key" 
            } 
        });
    }
    
    const isStreaming = pathname.includes(":streamGenerateContent");
    const isUnary = pathname.includes(":generateContent");

    if (req.method !== 'POST' || (!isStreaming && !isUnary)) {
        return createJsonErrorResponse(`Endpoint not found.`, 404, "NOT_FOUND");
    }

    try {
        const modelMatch = pathname.match(/models\/(.+?):/);
        if (!modelMatch || !modelMatch[1]) {
            return createJsonErrorResponse(`Could not extract model name from path: ${pathname}`, 400, "INVALID_ARGUMENT");
        }
        const modelName = modelMatch[1];
        
        const geminiRequest = await req.json();
        
        const authHeader = req.headers.get("Authorization");
        let apiKey = "";
        if (authHeader && authHeader.startsWith("Bearer ")) {
            apiKey = authHeader.substring(7);
        } else {
            apiKey = req.headers.get("x-goog-api-key") || "";
        }
        if (!apiKey) {
            return createJsonErrorResponse("API key is missing from headers.", 401, "UNAUTHENTICATED");
        }

        const ai = new GoogleGenAI({ apiKey });

        // --- 处理流式请求 ---
        if (isStreaming) {
            console.log("🚀 Handling STREAMING request...");
            
            // 严格按照最新规范调用 API
            const responseIterable = await ai.models.generateContentStream({
                model: modelName,
                ...geminiRequest,
            });

            // 创建一个新的流，用于向客户端转发格式化后的数据
            const responseStream = new ReadableStream({
                async start(controller) {
                    console.log("✅ Starting to process and forward stream chunks in SSE format...");
                    try {
                        // *** 核心修正：直接遍历 API 返回的对象，不再访问 .stream ***
                        for await (const chunk of responseIterable) {
                            const sseFormattedChunk = `data: ${JSON.stringify(chunk)}\n\n`;
                            controller.enqueue(new TextEncoder().encode(sseFormattedChunk));
                        }
                        console.log(`🏁 Stream from Google finished. Closing connection to client.`);
                        controller.close();
                    } catch(e) {
                         console.error("[CRITICAL] Error inside the stream processing loop:", e);
                         controller.error(e);
                    }
                }
            });

            return new Response(responseStream, {
                headers: {
                    "Content-Type": "text/event-stream", 
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            });
        }

        // --- 处理非流式请求 ---
        if (isUnary) {
            console.log("⚡ Handling NON-STREAMING (unary) request...");
            const result = await ai.models.generateContent({
                model: modelName,
                ...geminiRequest,
            });
            const responsePayload = result.response;
            return new Response(JSON.stringify(responsePayload), { 
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
            });
        }

    } catch (error) {
        console.error("[CRITICAL] An unexpected error was caught in the main handler:", error);
        return createJsonErrorResponse(error.message || "An unknown error occurred", 500);
    }
});
