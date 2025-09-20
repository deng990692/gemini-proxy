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
    // 在服务端日志中打印详细的错误信息
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

    // 处理浏览器的 CORS 预检请求 (Preflight)
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
    
    // 判断请求是流式还是非流式
    const isStreaming = pathname.includes(":streamGenerateContent");
    const isUnary = pathname.includes(":generateContent");

    // 如果不是我们期望处理的 POST 请求，则直接返回 404
    if (req.method !== 'POST' || (!isStreaming && !isUnary)) {
        return createJsonErrorResponse(`Endpoint not found.`, 404, "NOT_FOUND");
    }

    try {
        // 从路径中提取模型名称
        const modelMatch = pathname.match(/models\/(.+?):/);
        if (!modelMatch || !modelMatch[1]) {
            return createJsonErrorResponse(`Could not extract model name from path: ${pathname}`, 400, "INVALID_ARGUMENT");
        }
        const modelName = modelMatch[1];
        
        // --- 诊断日志 #1: 打印从客户端收到的完整请求体 ---
        const geminiRequest = await req.json();
        console.log("\n==============================================");
        console.log("---  DIAGNOSTIC LOG #1: Full Request Body from Client ---");
        try {
            // 使用 try-catch 避免因请求体过大或无法序列化而崩溃
            console.log(JSON.stringify(geminiRequest, null, 2));
        } catch (e) {
            console.log("Could not stringify the incoming request body:", e.message);
        }
        console.log("----------------------------------------------------------\n");
        
        // 提取 API Key
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

        // 初始化 Google AI 客户端
        const ai = new GoogleGenAI({ apiKey });

        // --- 处理流式请求 ---
        if (isStreaming) {
            console.log("🚀 Handling STREAMING request...");
            
            const streamResult = await ai.models.generateContentStream({
                model: modelName,
                ...geminiRequest,
            });

            // 创建一个新的流，用于向客户端转发格式化后的数据
            const responseStream = new ReadableStream({
                async start(controller) {
                    console.log("✅ Starting to process and forward stream chunks in SSE format...");
                    try {
                        let chunkCounter = 0;
                        // 遍历从 Google 获取的原始数据流
                        for await (const chunk of streamResult.stream) {
                            chunkCounter++;
                            
                            // --- 诊断日志 #2: 打印从 Google Gemini 收到的每一个数据块 ---
                            console.log(`\n--- DIAGNOSTIC LOG #2: Received Chunk #${chunkCounter} from Google ---`);
                             try {
                                console.log(JSON.stringify(chunk, null, 2));
                            } catch (e) {
                                console.log("Could not stringify the received chunk:", e.message);
                            }
                            console.log("-----------------------------------------------------------------");
                            
                            // 将数据块包装成 Server-Sent Events (SSE) 格式
                            const sseFormattedChunk = `data: ${JSON.stringify(chunk)}\n\n`;
                            
                            // 将格式化后的数据推入返回给客户端的流中
                            controller.enqueue(new TextEncoder().encode(sseFormattedChunk));
                        }
                        console.log(`🏁 Stream from Google finished after ${chunkCounter} chunks. Closing connection to client.`);
                        controller.close();
                    } catch (e) {
                        // 如果在处理流的过程中发生错误，打印出来
                        console.error("[CRITICAL] Error inside the stream processing loop:", e);
                        controller.error(e);
                    }
                }
            });

            // 将我们创建的流作为响应返回给客户端
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
            
            // --- 诊断日志 #3: 打印从 Google Gemini 收到的完整响应 ---
            console.log("\n==============================================");
            console.log("--- DIAGNOSTIC LOG #3: Full Response from Google (Unary) ---");
            try {
                console.log(JSON.stringify(responsePayload, null, 2));
            } catch(e) {
                console.log("Could not stringify the unary response:", e.message);
            }
            console.log("------------------------------------------------------------\n");

            return new Response(JSON.stringify(responsePayload), { 
                headers: { 
                    "Content-Type": "application/json", 
                    "Access-Control-Allow-Origin": "*" 
                } 
            });
        }

    } catch (error) {
        // 捕获所有其他未预料到的错误
        console.error("Error in main handler:", error);
        return createJsonErrorResponse(error.message || "An unknown error occurred", 500);
    }
});
