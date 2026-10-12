export const installCommand = (webUrl: string) =>
  `curl -fsSL ${webUrl}/install.sh | sh`;
