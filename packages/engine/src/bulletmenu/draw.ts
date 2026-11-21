// Draws the opened bullet and the pressed highlights (sprites 950..955).
import { blitKeyed, type Surface16 } from "../render/surface";
import type { BulletMenu } from "./bullet";
import { ICONS, highlightImageName } from "./geometry";

/** Images by file name (POCISK*.BM, LUPA_1.BM...). */
export type ImageLookup = (name: string) => Surface16 | undefined;

/** Draws onto a screen surface; `scrollX` converts the bullet's world position to screen. */
export function drawBullet(menu: BulletMenu, gun: boolean, images: ImageLookup, screen: Surface16, scrollX = 0): void {
  if (!menu.open) return;
  const bullet = images(gun ? "POCISK2.BM" : "POCISK.BM");
  if (!bullet) return;
  const x = menu.x - scrollX;
  blitKeyed(bullet, 0, 0, bullet.width, bullet.height, screen, x, menu.y);
  const lit = new Set(menu.highlights());
  for (const icon of ICONS) {
    if (!lit.has(icon.id)) continue;
    const img = images(highlightImageName(icon, gun));
    if (img) blitKeyed(img, 0, 0, img.width, img.height, screen, x + icon.x, menu.y + icon.y);
  }
}
