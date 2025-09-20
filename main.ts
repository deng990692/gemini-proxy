import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
// 严格按照最新的 @google/genai 库规范进行导入
import { GoogleGenAI } from "npm:@google/genai";

// --- 辅助函数：生成与 Gemini API 格式一致的错误 JSON 响应 ---
function createJsonErrorResponse(message: string, statusCode = 500) {
    const errorPayload = {
        error: {
            code: statusCode,
            message: message,
            status: "INTERNAL",
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
    const modelMatch = pathname.match(/models\/(.+?):(streamG|g)enerateContent/);
    if (!modelMatch || !modelMatch[1]) {
        return createJsonErrorResponse("Request path does not contain a valid model name.", 400);
    }
    const modelName = modelMatch[1];
    console.log(`- Intercepted request for model: ${modelName}`);

    // --- 统一的请求处理逻辑 ---
    try {
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
            return createJsonErrorResponse("API key is missing from headers.", 401);
        }

        // --- 初始化 Google GenAI 客户端 (正确方式) ---
        // 注意：新版库的构造函数接受一个包含 apiKey 的对象
        const ai = new GoogleGenAI({ apiKey });

        // --- 路由 1: 流式请求 (:streamGenerateContent) ---
        if (pathname.includes(":streamGenerateContent")) {
            console.log("🚀 Handling STREAMING request...");
            
            // --- 调用 generateContentStream (正确方式) ---
            // 将模型名称和请求内容一起传入
            const streamResult = await ai.models.generateContentStream({
                model: modelName,
                ...geminiRequest, // 将cherrystudio的请求体(contents等)直接展开传入
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

        // --- 路由 2: 非流式请求 (:generateContent) ---
        if (pathname.includes(":generateContent")) {
            console.log("⚡ Handling NON-STREAMING (unary) request...");

            // --- 调用 generateContent (正确方式) ---
            // 将模型名称和请求内容一起传入
            const result = await ai.models.generateContent({
                model: modelName,
                ...geminiRequest, // 将cherrystudio的请求体(contents等)直接展开传入
            });
            
            const responsePayload = result.response; 

            console.log("✅ Sending final NON-STREAMED payload.");
            return new Response(JSON.stringify(responsePayload), {
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                },
            });
        }
        
        return createJsonErrorResponse("Endpoint not found.", 404);

    } catch (error) {
        console.error("Error in handler:", error);
        return createJsonErrorResponse(error.message || "An unknown error occurred", 500);
    }
});
