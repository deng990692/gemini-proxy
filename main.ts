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

        // --- 流式请求的正确处理方式 ---
        if (isStreaming) {
            console.log("🚀 Handling STREAMING request...");
            
            // 1. 从 Google API 获取流
            const streamResult = await ai.models.generateContentStream({
                model: modelName,
                ...geminiRequest,
            });

            // 2. 直接将获取到的流作为响应体返回，不做任何处理！
            console.log("✅ Got stream from Google. Piping it directly to the client.");
            return new Response(streamResult.stream, {
                headers: {
                    // Gemini API流的Content-Type是application/json
                    "Content-Type": "application/json", 
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            });
        }

        // --- 非流式请求（保持不变）---
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
