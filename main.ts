import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { GoogleGenAI } from "npm:@google/genai";

/**
 * 辅助函数：生成一个标准格式的 JSON 错误响应
 * @param message 错误信息
 * @param statusCode HTTP 状态码
 * @param statusText 错误状态文本
 * @returns 一个 Deno Response 对象
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
        console.log("\n[INFO] Received request for model:", modelName);
        
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
            
            const streamResult = await ai.models.generateContentStream({
                model: modelName,
                ...geminiRequest,
            });

            // --- 诊断日志 和 安全检查 (最关键的部分) ---
            console.log("\n==============================================");
            console.log("---  DIAGNOSTIC LOG: Full 'streamResult' Object from Google ---");
            try {
                // 打印 Google API 返回的完整对象
                console.log(JSON.stringify(streamResult, null, 2));
            } catch (e) {
                console.log("Could not stringify streamResult:", e);
            }
            console.log("----------------------------------------------------------\n");
            
            // 安全检查：如果 streamResult 或者 streamResult.stream 不存在，则不能继续
            if (!streamResult || !streamResult.stream) {
                console.error("[CRITICAL] 'streamResult.stream' is missing or the whole result is falsy. The API likely returned an error payload instead of a stream.");
                return createJsonErrorResponse(
                    "Failed to get a valid stream from Google API. Check the server logs for the full response from Google.", 
                    502, // Bad Gateway,因为我们作为网关无法从上游（Google）获取正确响应
                    "BAD_GATEWAY"
                );
            }

            // 如果检查通过，我们才创建响应流
            const responseStream = new ReadableStream({
                async start(controller) {
                    console.log("✅ Safety check passed. Starting to forward stream chunks in SSE format...");
                    for await (const chunk of streamResult.stream) {
                        const sseFormattedChunk = `data: ${JSON.stringify(chunk)}\n\n`;
                        controller.enqueue(new TextEncoder().encode(sseFormattedChunk));
                    }
                    console.log(`🏁 Stream from Google finished. Closing connection to client.`);
                    controller.close();
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
