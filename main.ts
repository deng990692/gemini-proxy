import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { GoogleGenAI } from "npm:@google/genai";

// 辅助函数：生成错误响应
function createJsonErrorResponse(message: string, statusCode = 500, statusText = "INTERNAL") {
    const errorPayload = {
        error: { code: statusCode, message: message, status: statusText },
    };
    console.error("Replying with error:", JSON.stringify(errorPayload, null, 2));
    return new Response(JSON.stringify(errorPayload), {
        status: statusCode, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
}

// 主服务逻辑
serve(async (req) => {
    const pathname = new URL(req.url).pathname;

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, x-goog-api-key" } });
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
        console.log(`- Intercepted request for model: ${modelName}`);

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

        if (isStreaming) {
            console.log("🚀 Handling STREAMING request...");
            
            const streamResult = await ai.models.generateContentStream({
                model: modelName,
                ...geminiRequest,
            });

            // --- 正确的流转换逻辑 ---
            // 创建一个我们自己控制的新流
            const responseStream = new ReadableStream({
                async start(controller) {
                    console.log("✅ Starting to process and forward stream chunks in SSE format...");
                    // 遍历从 Google 获取的原始流
                    for await (const chunk of streamResult.stream) {
                        // 将每个 JSON chunk 转换为字符串
                        const chunkString = JSON.stringify(chunk);
                        
                        // *** The Crucial Step ***
                        // 包装成 SSE 格式
                        const sseFormattedChunk = `data: ${chunkString}\n\n`;
                        
                        // [新增日志] 打印我们到底发送了什么
                        // console.log(`[DEBUG] Sending chunk: ${sseFormattedChunk}`);
                        
                        // 将格式化后的字符串编码并推入我们的新流中
                        controller.enqueue(new TextEncoder().encode(sseFormattedChunk));
                    }
                    console.log("🏁 Stream from Google finished. Closing connection to client.");
                    // 关闭我们的流
                    controller.close();
                }
            });

            // 返回我们自己创建的、格式正确的流
            return new Response(responseStream, {
                headers: {
                    // *** The Crucial Header ***
                    // 明确告诉客户端这是一个 SSE 流
                    "Content-Type": "text/event-stream", 
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            });
        }

        // 非流式请求（保持不变）
        if (isUnary) {
            console.log("⚡ Handling NON-STREAMING (unary) request...");
            const result = await ai.models.generateContent({
                model: modelName,
                ...geminiRequest,
            });
            const responsePayload = result.response;
            return new Response(JSON.stringify(responsePayload), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        }

    } catch (error) {
        console.error("Error in handler:", error);
        return createJsonErrorResponse(error.message || "An unknown error occurred", 500);
    }
});
