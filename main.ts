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
    console.log(`\n--- New Request Received ---`);
    console.log(`[DEBUG] Request Method: ${req.method}, Full Pathname: ${pathname}`);

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, x-goog-api-key" } });
    }
    
    const isStreaming = pathname.includes(":streamGenerateContent");
    const isUnary = pathname.includes(":generateContent");

    if (req.method !== 'POST' || (!isStreaming && !isUnary)) {
        console.log(`[INFO] Ignoring non-POST or non-generate request to path: ${pathname}`);
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
            
            // --- 新增：在这里添加详细的日志和错误捕获 ---
            try {
                console.log("[DEBUG] Attempting to call Google API for streaming...");
                const streamResult = await ai.models.generateContentStream({
                    model: modelName,
                    ...geminiRequest,
                });
                console.log("[DEBUG] Successfully received stream response from Google API. Starting to process chunks...");

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
                return new Response(responseStream, { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache", "Connection": "keep-alive" } });

            } catch (e) {
                console.error("[CRITICAL] Error occurred during the call to Google API (stream):", e);
                return createJsonErrorResponse(`Failed to call Google API: ${e.message}`, 502, "BAD_GATEWAY");
            }
        }

        if (isUnary) {
            console.log("⚡ Handling NON-STREAMING (unary) request...");
            // (为非流式也添加了类似的保护)
             try {
                console.log("[DEBUG] Attempting to call Google API for unary...");
                const result = await ai.models.generateContent({
                    model: modelName,
                    ...geminiRequest,
                });
                console.log("[DEBUG] Successfully received unary response from Google API.");
                const responsePayload = result.response;
                return new Response(JSON.stringify(responsePayload), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
            } catch (e) {
                console.error("[CRITICAL] Error occurred during the call to Google API (unary):", e);
                return createJsonErrorResponse(`Failed to call Google API: ${e.message}`, 502, "BAD_GATEWAY");
            }
        }

    } catch (error) {
        console.error("Error in main handler:", error);
        return createJsonErrorResponse(error.message || "An unknown error occurred", 500);
    }
});
