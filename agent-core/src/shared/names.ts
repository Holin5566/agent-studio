/**
 * 對外可見的識別字串,由 mcp-hub 擁有 —— gateway 的 server 名就是 claude 的工具名
 * 前綴(`mcp__<name>__<tool id>`),改它等於改模型看到的工具名。
 *
 * 這裡只轉出去,讓 AgentCore 內部與公開 index 沿用同一個匯入路徑。
 */
export { GATEWAY_SERVER_NAME, BUILTIN_SERVER_NAME, PROTOCOL_VERSION } from 'mcp-hub';
