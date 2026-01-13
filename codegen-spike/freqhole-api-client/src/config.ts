// Client configuration

let baseUrl = 'http://localhost:3000';

export function getBaseUrl(): string {
  return baseUrl;
}

export function setBaseUrl(url: string) {
  baseUrl = url;
}
