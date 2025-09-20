import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { GoogleGenAI } from "npm:@google/genai";

// 辅助函数：生成错误响应
function createJsonErrorResponse(message: string, statusCode = 500, statusText = "INTERNAL") {
    const errorPayload = {
        error: {
            code: statusCode,
            message: message,
            status: statusText,
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

// 主服务逻辑
serve(async (req) => {
    const pathname = new URL(req.url).pathname;

    // --- 新增：为每一次请求都打印详细日志 ---
    console.log(`\n--- New Request Received ---`);
    console.log(`[DEBUG] Request Method: ${req.method}, Full Pathname: ${pathname}`);

    // CORS 预检请求处理
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
    
    // --- 改进：更精准的路由判断 ---
    // 只处理包含 :generateContent 或 :streamGenerateContent 的POST请求
    const isStreaming = pathname.includes(":streamGenerateContent");
    const isUnary = pathname.includes(":generateContent");

    if (req.method !== 'POST' || (!isStreaming && !isUnary)) {
        console.log(`[INFO] Ignoring non-POST or non-generate request to path: ${pathname}`);
        return createJsonErrorResponse(
            `Endpoint not found. This proxy only handles POST requests to paths ending with ':generateContent' or ':streamGenerateContent'.`, 
            404, 
            "NOT_FOUND"
        );
    }

    try {
        // 动态模型名称提取
        const modelMatch = pathname.match(/models\/(.+?):/);
        if (!modelMatch || !modelMatch[1]) {
            // 这个错误现在只会在路径格式错误时触发，例如 "models/:generateContent"
            return createJsonErrorResponse(`Could not extract model name from path: ${pathname}`, 400, "INVALID_ARGUMENT");
        }
        const modelName = modelMatch[1];
        console.log(`- Intercepted request for model: ${modelName}`);

        const geminiRequest = await req.json();

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

        const ai = new GoogleGenAI({ apiKey });

        // 流式请求
        if (isStreaming) {
            console.log("🚀 Handling STREAMING request...");
            const streamResult = await ai.models.generateContentStream({
                model: modelName,
                ...geminiRequest,
            });
            
            const responseStream = new ReadableStream({
                async start(controller) {
                    for await (const chunk of streamResult.stream) {
                        const chunkString = `data: ${JSON.stringify(chunk)}\n\n`;
                        controller.enqueue(new TextEncoder().encode(chunkString));
                    }
                    console.log("✅ Stream finished.");
                    controller.close();
                }
            });

            return new Response(responseStream, {
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            });
        }

        // 非流式请求
        if (isUnary) {
            console.log("⚡ Handling NON-STREAMING (unary) request...");
            const result = await ai.models.generateContent({
                model: modelName,
                ...geminiRequest,
            });
            const responsePayload = result.response;
            return new Response(JSON.stringify(responsePayload), {
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                },
            });
        }

    } catch (error) {
        console.error("Error in handler:", error);
        return createJsonErrorResponse(error.message || "An unknown error occurred", 500);
    }
});
