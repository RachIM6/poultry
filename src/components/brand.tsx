import { Readex_Pro } from "next/font/google";
import { useId } from "react";

// The validated identity (2026-11-12): a white egg holding the Atlas range on the Poussin tile, and the two-line
// wordmark "DigiAtlas / VOLAILLE" in Readex Pro. The Arabic name isn't chosen yet: both languages show this one.
const readex = Readex_Pro({ subsets: ["latin"] });

const EGG = "M66 18c-20 0-34 29-34 52a34 34 0 0 0 68 0c0-23-14-52-34-52z";

export function BrandMark({ size }: { size: number }) {
  const clip = useId(); // several marks may share a page
  return (
    <svg viewBox="0 0 132 132" width={size} height={size} aria-hidden="true" className="shrink-0">
      <defs>
        <clipPath id={clip}>
          <path d={EGG} />
        </clipPath>
      </defs>
      <rect width="132" height="132" rx="30" fill="#F2C14E" />
      <path d={EGG} fill="#FFFFFF" />
      <path clipPath={`url(#${clip})`} d="M20 120V88l26-26 14 12 18-22 34 36v32z" fill="#24211C" />
    </svg>
  );
}

/** Mark + wordmark. `large` is the login screen's size (72 / 44 / 16 px), otherwise the menu's (40 / 22 / 10 px). */
export function BrandLockup({ large = false }: { large?: boolean }) {
  return (
    <span dir="ltr" aria-label="DigiAtlas-VOLAILLE" role="img" className={`${readex.className} inline-flex items-center gap-3`}>
      <BrandMark size={large ? 72 : 40} />
      <span className={`flex flex-col ${large ? "gap-2" : "gap-[5px]"} leading-none`}>
        <span className={`${large ? "text-[44px]" : "text-[22px]"} tracking-[-0.01em]`}>
          <span className="font-medium">Digi</span>
          <span className="font-bold">Atlas</span>
        </span>
        <span className={`${large ? "text-base" : "text-[10px]"} font-semibold tracking-[0.32em] text-[#55504A] dark:text-[#F2C14E]`}>VOLAILLE</span>
      </span>
    </span>
  );
}
