export type MessageType = "private" | "group";

export interface MessageSegment {
  type: string;
  data: Record<string, unknown>;
}

export interface OneBotSender {
  user_id?: number;
  nickname?: string;
  card?: string;
  sex?: string;
  age?: number;
  role?: "owner" | "admin" | "member";
  group_name?: string;
}

export interface OneBotMessageEvent {
  post_type: "message";
  message_type: MessageType;
  sub_type?: string;
  message_id: number;
  user_id: number;
  group_id?: number;
  message: MessageSegment[] | string;
  raw_message?: string;
  sender: OneBotSender;
  time: number;
  self_id: number;
}

export interface OneBotNoticeEvent {
  post_type: "notice";
  notice_type: string;
  sub_type?: string;
  user_id?: number;
  group_id?: number;
  target_id?: number;
  self_id?: number;
  time: number;
  file?: {
    name?: string;
    size?: number;
    url?: string;
    file_id?: string;
  };
  suffix?: string;
  content?: string;
  comment?: string;
  text?: string;
  poke_message?: string;
}

export interface OneBotRequestEvent {
  post_type: "request";
  request_type: "friend" | "group";
  user_id: number;
  group_id?: number;
  sub_type?: string;
  comment?: string;
  flag: string;
  time: number;
}

export interface OneBotMetaEvent {
  post_type: "meta_event";
  meta_event_type: string;
  sub_type?: string;
  time: number;
}

export type OneBotEvent =
  | OneBotMessageEvent
  | OneBotNoticeEvent
  | OneBotRequestEvent
  | OneBotMetaEvent;

export interface QQFileInfo {
  name: string;
  size: number;
  url: string;
  fileId: string;
}

export interface StickerCandidate {
  kind: "image" | "mface" | "marketface";
  name?: string;
  summary?: string;
  file?: string;
  url?: string;
  fileId?: string;
  key?: string;
  emojiId?: string;
  emojiPackageId?: string;
  /** Protocol-level marker: image converted from market emoji. */
  protocolEmoji?: boolean;
  segmentIndex: number;
}

export interface QQMessage {
  id: string;
  userId: string;
  content: string;
  messageType: MessageType;
  groupId?: string;
  rawMessage: string;
  timestamp: number;
  sender: OneBotSender;
  atBot: boolean;
  files: QQFileInfo[];
  imageUrls: string[];
  /** OneBot 图片段的 file 参数，用于 get_image，与 imageUrls 一一对应（可能为空） */
  imageFiles: string[];
  /** 图片段的 file_id，与 imageUrls 一一对应（NapCat 等实现常用，与 file 二选一） */
  imageFileIds: string[];
  /** 表情包候选（含 mface/marketface 与携带 emoji 字段的 image） */
  stickerCandidates: StickerCandidate[];
}

export interface OneBotApiResult {
  status: string;
  retcode: number;
  data?: unknown;
  message?: string;
}

export interface NapCatPluginConfig {
  httpUrl: string;
  wsUrl: string;
  token: string;
  selfId: string;
}
