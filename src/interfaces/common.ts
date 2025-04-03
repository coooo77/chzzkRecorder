import type { Channel, BaseVideo } from 'chzzk'

export type LogMsgType = 'warn' | 'info' | 'success' | 'fail' | 'error' | 'title'

export type CustomUserName = string

export type IdList = Record<Channel['channelId'], CustomUserName>

export type VideoWithIsAdult = BaseVideo & { adult: boolean }
