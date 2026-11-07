import { AsyncLocalStorage } from 'node:async_hooks';
import { PUBLIC_MEDIA_BUCKETS, publicMediaOrigin } from './public_media';

function mediaOrigins(gender: string) {
  const bucket = PUBLIC_MEDIA_BUCKETS[gender === 'female' ? 1 : 0];
  return [bucket.legacy, publicMediaOrigin(bucket.env, bucket.legacy)];
}

// Request-local presentation only. It never changes exercise eligibility or load.
export const exercisePresentation = new AsyncLocalStorage<{gender?: string}>();
export function exerciseMediaGender() {
  return exercisePresentation.getStore()?.gender === 'FEMALE' ? 'female' : 'male';
}
type Variant = {url:string;posterUrl?:string;aspectRatio?:number};
export function verifiedVideoVariant(value: unknown): Variant | null {
  if (!value || typeof value !== 'object') return null;
  const variant=value as Record<string,unknown>;
  try {
    const url=new URL(String(variant.url||''));
    const origins=[...mediaOrigins('male'), ...mediaOrigins('female')];
    if(url.protocol!=='https:'||!origins.includes(url.origin)||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('.mp4'))return null;
    let posterUrl:string|undefined;
    if(typeof variant.posterUrl==='string'){
      const poster=new URL(variant.posterUrl);
      if(poster.origin===url.origin&&poster.protocol==='https:'&&!poster.username&&!poster.password&&!poster.search&&!poster.hash&&/\.(jpg|png|webp)$/.test(poster.pathname))posterUrl=poster.href;
    }
    const ratio=typeof variant.aspectRatio==='number'&&Number.isFinite(variant.aspectRatio)&&variant.aspectRatio>=.5&&variant.aspectRatio<=2.5?variant.aspectRatio:undefined;
    return {url:url.href,...(posterUrl?{posterUrl}:{}),...(ratio?{aspectRatio:ratio}:{})};
  }catch{return null;}
}
export function preferredExerciseMedia(variants: unknown, gender = exerciseMediaGender()): Variant | null {
  if(!variants||typeof variants!=='object')return null;
  const values=variants as Record<string,unknown>;
  const variant = verifiedVideoVariant(values[gender]);
  return variant && mediaOrigins(gender).includes(new URL(variant.url).origin) ? variant : null;
}
