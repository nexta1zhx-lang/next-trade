import type {CapacitorConfig} from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.nexttrade.app',
  appName: 'NextTrade',
  webDir: 'out',
  server: {
    // 使用 HTTP 而非 HTTPS，避免 Mixed Content 阻止 API 请求
    androidScheme: 'http',
    cleartext: true,
  },
}

export default config
