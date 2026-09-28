"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

/** Own the drawer's scroll/focus lifetime, including Safari's body scroller. */
export function useDrawerModal(drawerRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const releaseRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const drawer = drawerRef.current;
    const backdrop = drawer?.parentElement;
    if (!drawer || !backdrop) return;
    const body = document.body;
    const root = document.documentElement;
    const background = document.querySelector<HTMLElement>(".application");
    const wasInert = background?.inert ?? false;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const x = window.scrollX, y = window.scrollY;
    const saved = new Map<string, [string, string]>();
    for (const property of ["position", "top", "left", "width", "overflow", "padding-right"]) {
      saved.set(property, [body.style.getPropertyValue(property), body.style.getPropertyPriority(property)]);
    }
    const rootOverflow = [root.style.getPropertyValue("overflow"), root.style.getPropertyPriority("overflow")];
    const rootScroll = [root.style.getPropertyValue("scroll-behavior"), root.style.getPropertyPriority("scroll-behavior")];
    const scrollbarWidth = window.innerWidth - root.clientWidth;
    const paddingRight = parseFloat(getComputedStyle(body).paddingRight) || 0;
    body.style.position = "fixed";
    body.style.top = `${-y}px`;
    body.style.left = `${-x}px`;
    body.style.width = "100%";
    // A hidden overflow body becomes the sticky toolbar's scroll ancestor.
    // Clip does not create a scroller; the fixed body/root lock still block the page.
    body.style.overflow = CSS.supports("overflow", "clip") ? "clip" : "visible";
    if (scrollbarWidth > 0) body.style.paddingRight = `${paddingRight + scrollbarWidth}px`;
    root.style.overflow = "hidden";
    // Avoid the site's smooth scrolling animating a restored scroll position.
    root.style.setProperty("scroll-behavior", "auto", "important");
    if (background) background.inert = true;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (background) background.inert = wasInert;
      for (const [property, [value, priority]] of saved) {
        if (value) body.style.setProperty(property, value, priority);
        else body.style.removeProperty(property);
      }
      if (rootOverflow[0]) root.style.setProperty("overflow", rootOverflow[0], rootOverflow[1]);
      else root.style.removeProperty("overflow");
      window.scrollTo(x, y);
      if (rootScroll[0]) root.style.setProperty("scroll-behavior", rootScroll[0], rootScroll[1]);
      else root.style.removeProperty("scroll-behavior");
    };
    releaseRef.current = release;

    const buttons = () => Array.from(drawer.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]'));
    (buttons()[0] ?? drawer).focus({ preventScroll: true });
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const targets = buttons(), first = targets[0], last = targets.at(-1);
      if (!first || !last) { event.preventDefault(); drawer.focus(); return; }
      if (!drawer.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    };
    // Prevent edge gestures from chaining into Safari's viewport/backdrop.
    const atEdge = (delta: number) => delta < 0 ? drawer.scrollTop <= 0 : drawer.scrollTop + drawer.clientHeight >= drawer.scrollHeight - 1;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) return; // Preserve browser zoom.
      if (!drawer.contains(event.target as Node) || (event.deltaY !== 0 && atEdge(event.deltaY))) event.preventDefault();
    };
    let touchY: number | null = null;
    const touchStart = (event: TouchEvent) => { touchY = event.touches.length === 1 ? event.touches[0].clientY : null; };
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1 || touchY === null) return;
      const delta = touchY - event.touches[0].clientY;
      touchY = event.touches[0].clientY;
      if (!drawer.contains(event.target as Node) || (delta !== 0 && atEdge(delta))) event.preventDefault();
    };
    document.addEventListener("keydown", keyDown);
    backdrop.addEventListener("wheel", wheel, { passive: false });
    backdrop.addEventListener("touchstart", touchStart, { passive: true });
    backdrop.addEventListener("touchmove", touchMove, { passive: false });
    return () => {
      document.removeEventListener("keydown", keyDown);
      backdrop.removeEventListener("wheel", wheel);
      backdrop.removeEventListener("touchstart", touchStart);
      backdrop.removeEventListener("touchmove", touchMove);
      release();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [drawerRef]);

  // Navigation releases synchronously, before setView scrolls the new page.
  return () => releaseRef.current();
}
