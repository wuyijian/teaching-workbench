/**
 * Agent 类型定义（JSDoc）
 * @fileoverview 定义 PetAdvisor AI Agent 的核心数据结构和类型
 */

/**
 * @typedef {Object} Message
 * @property {'system'|'user'|'assistant'|'tool'} role
 * @property {string} content
 * @property {string} [tool_call_id] - tool 消息专用
 * @property {ToolCall[]} [tool_calls] - assistant 消息专用
 */

/**
 * @typedef {Object} ToolCall
 * @property {string} id
 * @property {string} type - 固定 'function'
 * @property {FunctionCall} function
 */

/**
 * @typedef {Object} FunctionCall
 * @property {string} name - 工具名
 * @property {string} arguments - JSON 字符串参数
 */

/**
 * @typedef {Object} Tool
 * @property {string} name
 * @property {string} description
 * @property {Object} parameters - JSON Schema
 * @property {function(Object): Promise<string>} execute
 */

/**
 * @typedef {Object} AgentSession
 * @property {string} sessionId
 * @property {Message[]} messages
 * @property {Object} context - 用户上下文（宠物类型、偏好等）
 * @property {number} lastActiveAt
 */

/**
 * @typedef {Object} AgentRequest
 * @property {string} sessionId
 * @property {string} message
 * @property {Object} [userContext] - 当前用户信息
 * @property {string} [userContext.petType]
 * @property {string} [userContext.petAge]
 * @property {string} [userContext.budget]
 */

/**
 * @typedef {Object} AgentResponse
 * @property {string} reply - 展示给用户的文本
 * @property {Object[]} [recommendations] - 推荐商品
 * @property {boolean} [needsClarification] - 是否需要进一步澄清
 * @property {string} [clarificationQuestion] - 澄清问题
 */

module.exports = {};
