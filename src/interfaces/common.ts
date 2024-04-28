import type { Channel } from 'chzzk'

export type LogMsgType = 'warn' | 'info' | 'success' | 'fail' | 'error' | 'title'

export type CustomUserName = string

export type IdList = Record<Channel['channelId'], CustomUserName>
