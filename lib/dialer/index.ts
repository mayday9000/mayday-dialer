import type { Dialer, DialerOptions, DialerProviderName } from "./types";
import { StubDialer } from "./stub";
import { TwilioDialer } from "./twilio";

export * from "./types";

/** Factory: pick a dialer implementation by provider name. */
export function createDialer(provider: DialerProviderName, opts: DialerOptions = {}): Dialer {
  switch (provider) {
    case "twilio":
      return new TwilioDialer(opts);
    case "stub":
    default:
      return new StubDialer(opts);
  }
}
