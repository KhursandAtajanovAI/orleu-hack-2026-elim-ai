/** Статический экспорт: хостится на GitHub Pages (или Vercel). Данные — напрямую из Supabase с RLS. */
const basePath = process.env.NEXT_BASE_PATH || '';
export default {
  output: 'export',
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ['@kaida/contracts'],
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};
