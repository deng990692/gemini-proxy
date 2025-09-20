import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
// 从 npm 导入最新的 Google GenAI 库
import { GoogleGenerativeAI, Part } from "npm:@google/genai";

// --- 辅助函数：生成与 Gemini API 格式一致的错误 JSON 响应 ---
function createJsonErrorResponse(message: string, statusCode = 500) {
    const errorPayload = {
        error: {
            code: statusCode,
            message: message,
            status: "INTERNAL", // 使用一个常见的错误状态
        },
    };
    console.error("Replying with error:", JSON.stringify(errorPayload, null, 2));
    return new Response(JSON.stringify(errorPayload), {
        status: statusCode,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
    });
}

// --- 主服务逻辑 ---
serve(async (req) => {
    const pathname = new URL(req.url).pathname;

    // --- CORS 预检请求处理 ---
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization, x-goog-api-key",
            },
        });
    }

    // --- 动态模型名称提取 ---
    // 匹配类似 /v1beta/models/gemini-1.5-flash-latest:streamGenerateContent 的路径
    const modelMatch = pathname.match(/models\/(.+?):(streamG|g)enerateContent/);
    if (!modelMatch || !modelMatch[1]) {
        return createJsonErrorResponse("Request path does not contain a valid model name.", 400);
    }
    const modelName = modelMatch[1];
    console.log(`- Intercepted request for model: ${modelName}`);

    // --- 统一的请求处理逻辑 ---
    try {
        const geminiRequest = await req.json();

        // 提取 API Key (兼容 Bearer Token 和 x-goog-api-key)
        const authHeader = req.headers.get("Authorization");
        let apiKey = "";
        if (authHeader && authHeader.startsWith("Bearer ")) {
            apiKey = authHeader.substring(7);
        } else {
            apiKey = req.headers.get("x-goog-api-key") || "";
        }

        if (!apiKey) {
            return createJsonErrorResponse("API key is missing from headers.", 401);
        }
        
        // --- 初始化 Google GenAI 客户端 ---
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName });

        // --- 路由 1: 流式请求 (:streamGenerateContent) ---
        if (pathname.includes(":streamGenerateContent")) {
            console.log("🚀 Handling STREAMING request...");
            
            // 直接使用 @google/genai 库的流式生成功能
            const streamResult = await model.generateContentStream(geminiRequest);
            
            // 创建一个可读流，将 SDK 的输出转换为 SSE (Server-Sent Events) 格式
            const responseStream = new ReadableStream({
                async start(controller) {
                    for await (const chunk of streamResult.stream) {
                        const chunkString = `data: ${JSON.stringify(chunk)}\n\n`;
                        controller.enqueue(new TextEncoder().encode(chunkString));
                    }
                    // 注意：Google GenAI SDK 的流会自动结束，
                    // CherryStudio 这类客户端通常通过解析流内容中的 finishReason 来判断结束，
                    // 不再需要手动发送 [DONE]
                    console.log("✅ Stream finished.");
                    controller.close();
                }
            });

            return new Response(responseStream, {
                headers: {
                    "Content-Type": "application/json", // Gemini 流式 API 返回的是 application/json
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            });
        }

        // --- 路由 2: 非流式请求 (:generateContent) ---
        if (pathname.includes(":generateContent")) {
            console.log("⚡ Handling NON-STREAMING (unary) request...");

            // 直接调用 @google/genai 库的非流式生成功能
            const result = await model.generateContent(geminiRequest);
            const responsePayload = result.response; // 获取完整的响应内容

            console.log("✅ Sending final NON-STREAMED payload.");
            return new Response(JSON.stringify(responsePayload), {
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                },
            });
        }
        
        // 如果路径不匹配任何已知路由
        return createJsonErrorResponse("Endpoint not found.", 404);

    } catch (error) {
        console.error("Error in handler:", error);
        return createJsonErrorResponse(error.message || "An unknown error occurred", 500);
    }
});
