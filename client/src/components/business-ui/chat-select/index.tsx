/**
 * Public entry point for ChatSelect: re-exports the component, its prop/value
 * types and value helper utilities.
 * Part of the vendored business-ui component library.
 */
export { ChatSelect } from '@client/src/components/business-ui/chat-select/chat-select';
export type {
  ChatInfo,
  Chat,
  ChatSelectProps,
  ChatSelectValue,
  ValueType as ChatSelectValueType,
} from '@client/src/components/business-ui/chat-select/types';
export {
  extractIdsFromValue,
  isIdModeValue,
} from '@client/src/components/business-ui/chat-select/utils';
