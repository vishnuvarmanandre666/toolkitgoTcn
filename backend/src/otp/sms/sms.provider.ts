import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { maskPhone } from '../../common/utils/identity';

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsProvider {
  /** @param phone 10-digit Indian mobile number */
  sendOtp(phone: string, otp: string): Promise<void>;
}

/**
 * MSG91 Flow API (v5). The OTP is generated and verified by ToolkitGo; MSG91
 * only delivers it using a DLT-approved Flow template containing a variable
 * named by MSG91_OTP_VARIABLE (e.g. "Your ToolkitGo OTP is ##otp##").
 *
 * POST {MSG91_BASE_URL}/flow
 * headers: authkey, content-type: application/json
 * body: { template_id, short_url: "0", recipients: [{ mobiles: "91XXXXXXXXXX", <var>: "<otp>" }] }
 */
@Injectable()
export class Msg91SmsProvider implements SmsProvider {
  private readonly logger = new Logger('MSG91');
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async sendOtp(phone: string, otp: string): Promise<void> {
    const { authKey, templateId, senderId, baseUrl, otpVariable } = this.config.sms.msg91;
    if (!authKey || !templateId) throw new Error('MSG91 is not configured (MSG91_AUTH_KEY / MSG91_TEMPLATE_ID)');

    const body: Record<string, unknown> = {
      template_id: templateId,
      short_url: '0',
      recipients: [{ mobiles: `91${phone}`, [otpVariable]: otp }],
    };
    if (senderId) body.sender = senderId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${baseUrl}/flow`, {
        method: 'POST',
        headers: { authkey: authKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let json: { type?: string; message?: string } = {};
      try {
        json = JSON.parse(text);
      } catch {
        /* non-JSON error body */
      }
      if (!res.ok || json.type === 'error') {
        // Never log the OTP or the full number.
        this.logger.error(`MSG91 send failed for ${maskPhone(phone)}: HTTP ${res.status} ${json.message ?? ''}`);
        throw new Error('SMS delivery failed');
      }
      this.logger.log(`OTP SMS queued for ${maskPhone(phone)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Development driver: prints the OTP to the server log. Refused in production by config validation. */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SMS:console');
  async sendOtp(phone: string, otp: string): Promise<void> {
    this.logger.warn(`[DEV ONLY] OTP for ${maskPhone(phone)} is ${otp}`);
  }
}
