/**
 * 新模型的默认值 —— 只此一份，别在表单里再写一遍字面量。
 *
 * 三个值都是刻意选的：
 *   - **最大令牌数直接拉满**：它是「这一次最多能吐多少」的上限，写小了只会莫名
 *     其妙被截断；自己跑本地小模型、显存吃紧的再手动调小。
 *   - **温度 1**：多数服务商的默认采样温度，也最能反映模型本来的脾气。
 *   - **系统提示词留空**：新一代模型自带的默认行为通常比一句通用的
 *     "You are a helpful assistant." 更合适，顺便省掉每次请求的 token。
 */
export const MAX_TOKENS_LIMIT = 65535;
export const DEFAULT_TEMPERATURE = 1;
export const DEFAULT_MAX_TOKENS = MAX_TOKENS_LIMIT;
export const DEFAULT_SYSTEM_PROMPT = '';
