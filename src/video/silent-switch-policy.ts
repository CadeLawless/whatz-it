type SilentSwitchPolicyInput = {
  platform: string;
  monitoringSupported: boolean;
  silentSwitchOn: boolean;
};

export function shouldSuppressLiveRoundSound({
  platform,
  monitoringSupported,
  silentSwitchOn,
}: SilentSwitchPolicyInput) {
  return platform === 'ios' && monitoringSupported && silentSwitchOn;
}
