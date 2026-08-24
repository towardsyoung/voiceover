/**
 * 阿里云 OSS 上传模块（参考 Toonflow src/utils/oss.ts）
 *
 * 用途：火山素材库 CreateAsset 只接受公网 HTTP(S) URL。
 * 配置 OSS 后，本地图片先上传 OSS 获取公网 URL，再提交火山审核，
 * 无需将本服务暴露到公网。
 *
 * 必需配置：OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_REGION / OSS_BUCKET
 * 可选配置：OSS_PUBLIC_BASE_URL（自定义域名/CDN，缺省用 bucket 内网域名）
 *           OSS_ENDPOINT（自定义 endpoint）OSS_PREFIX（对象 key 前缀）
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { env } from "../env.js";

function log(msg: string) {
  console.log(`[oss] ${msg}`);
}

export function hasOssConfig(): boolean {
  return Boolean(env.ossAccessKeyId && env.ossAccessKeySecret && env.ossRegion && env.ossBucket);
}

export function hasPublicAccess(): boolean {
  return hasOssConfig() && Boolean(env.ossPublicBaseUrl);
}

let clientPromise: Promise<any> | null = null;

async function getClient(): Promise<any> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const mod = await import("ali-oss");
      const OSSClient = (mod as any).default || mod;
      return new OSSClient({
        region: env.ossRegion,
        bucket: env.ossBucket,
        accessKeyId: env.ossAccessKeyId,
        accessKeySecret: env.ossAccessKeySecret,
        endpoint: env.ossEndpoint || undefined,
        secure: true,
      });
    })();
  }
  return clientPromise;
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function objectKeyFor(absPath: string, contentHash: string): string {
  const ext = extname(absPath).toLowerCase() || ".png";
  const base = env.ossPrefix ? `${env.ossPrefix}/` : "";
  return `${base}voiceover/assets/${contentHash}${ext}`;
}

export function publicUrlFor(key: string): string {
  if (!env.ossPublicBaseUrl) throw new Error("未配置 OSS_PUBLIC_BASE_URL，无法生成公网 URL");
  return `${env.ossPublicBaseUrl}/${key.replace(/^\/+/, "")}`;
}

/**
 * 上传本地图片到 OSS，返回公网 URL。
 * 对象 key 使用文件内容 sha256，内容不变则不重复上传（先 head 探测）。
 */
export async function uploadImageToOss(absPath: string): Promise<string> {
  if (!hasOssConfig()) throw new Error("OSS 未配置（OSS_ACCESS_KEY_ID/SECRET/REGION/BUCKET）");
  if (!env.ossPublicBaseUrl) throw new Error("未配置 OSS_PUBLIC_BASE_URL");

  const buf = readFileSync(absPath);
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 32);
  const key = objectKeyFor(absPath, hash);
  const client = await getClient();

  // 已存在则跳过上传
  try {
    await client.head(key);
    log(`对象已存在，跳过上传: ${key} bytes=${buf.length}`);
    return publicUrlFor(key);
  } catch {
    /* 不存在，继续上传 */
  }

  const mime = MIME[extname(absPath).toLowerCase()] || "application/octet-stream";
  const startedAt = Date.now();
  await client.put(key, buf, { mime });
  log(`上传成功: ${key} bytes=${buf.length} cost=${Date.now() - startedAt}ms`);
  return publicUrlFor(key);
}
