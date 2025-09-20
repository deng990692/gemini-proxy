# Gemini API 代理服务

一个部署在 Deno Deploy 上的 Gemini API 代理服务，支持多种聊天客户端（如 ChatBox、CherryStudio 等）通过统一的认证方式访问 Google Gemini 模型。

🌟 **功能特点**

*   **统一认证**：使用自定义密钥保护你的 Gemini API，避免真实 API Key 泄露
*   **多客户端支持**：兼容 CherryStudio、ChatBox 等主流 AI 聊天客户端
*   **多 API Key 轮换**：支持配置多个 Gemini API Key，自动随机轮换使用，避免触发速率限制
*   **完全透明代理**：原封不动转发请求和响应，支持流式响应
*   **详细日志**：提供请求追踪和调试信息

🚀 **快速部署**

### 部署步骤

**方法一：通过 GitHub 部署（推荐）**

1.  使用您的 GitHub 账号登录 [Deno Deploy Dashboard](https://dash.deno.com/projects)。
2.  点击 "New Project"
3.  选择你的 GitHub 仓库
4.  选择 `main.ts` 作为入口文件
5.  点击 "Deploy Project"

| 变量名 | 说明                      | 示例                 |
| :----- | :------------------------ | :------------------- |
| `key`  | 客户端认证密钥，自定义设置 | `sk-my-secret-key-123` |
| `apikey` | Gemini API Key，支持多个（逗号分隔） | `AIzaSyxxxxx1,AIzaSyxxxxx2` |

📖 **使用方法**

### 在 CherryStudio 中配置

1.  打开 CherryStudio 设置
2.  添加新的服务商配置：
    *   服务商类型：`gemini`
    *   API Base URL：`https://your-project.deno.dev`
    *   API Key：`sk-my-secret-key-123`（你在环境变量中设置的 `key`）
    *   模型：`gemini-2.5-flash` 或 `gemini-2.5-pro`
