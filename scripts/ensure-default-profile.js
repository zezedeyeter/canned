/**
 * Packager --extra-resource=build/default-profile.jpg için hedef dosyayı oluşturur.
 * Yoksa önce kökteki profile.jpg kopyalanır; o da yoksa minik geçerli bir JPEG yazılır.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');
const dest = path.join(buildDir, 'default-profile.jpg');
const fromProfile = path.join(root, 'profile.jpg');

// 1×1 px geçerli JPEG (base64)
const PLACEHOLDER_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=',
  'base64',
);

fs.mkdirSync(buildDir, { recursive: true });

if (fs.existsSync(dest)) {
  process.exit(0);
}

if (fs.existsSync(fromProfile)) {
  fs.copyFileSync(fromProfile, dest);
  console.log('[ensure-default-profile] profile.jpg → build/default-profile.jpg');
} else {
  fs.writeFileSync(dest, PLACEHOLDER_JPEG);
  console.log('[ensure-default-profile] Yer tutucu build/default-profile.jpg oluşturuldu.');
}
