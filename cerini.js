/* ==================================================================
 * Cerini — storefront enhancement layer (compose-only)
 * Injected via a <script> in a Code block (templates/pages/*.json).
 * Reads existing product-card markup and adds Figma features that the
 * unforked theme can't render natively.
 *
 * v1: Quick view (ojito) trigger on every product card.
 *     - desktop: next to the product name
 *     - mobile: over the image, below the favorite
 *     Wire: reuses the theme's native quick-shop modal if the card has
 *     one; otherwise falls back to the product page.
 * ================================================================== */
(function () {
  "use strict";

  var CARD = ".js-item-product[data-product-id]";
  var DONE = "data-cerini-qv";

  function eyeSVG() {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<path d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 ' +
      '8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 ' +
      '0-8.573-3.007-9.964-7.178Z"/><circle cx="12" cy="12" r="3"/></svg>'
    );
  }

  function openQuickView(card) {
    // v1: reuse the theme's native quick-shop modal if this card has one.
    var trigger = card.querySelector(
      ".js-quickshop-modal-open, .product-item-quick-shop-modal-trigger"
    );
    if (trigger) {
      trigger.click();
      return;
    }
    // Fallback: go to the product detail page.
    var link = card.querySelector(
      "a.product-item-link, a.js-product-item-image-link-private, a[href]"
    );
    if (link && link.href) window.location.href = link.href;
  }

  function makeEye(card, context) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cerini-qv cerini-qv-" + context;
    btn.setAttribute("aria-label", "Vista rápida");
    btn.setAttribute("title", "Vista rápida");
    btn.innerHTML = eyeSVG();
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openQuickView(card);
    });
    return btn;
  }

  function ensureRelative(el) {
    if (el && getComputedStyle(el).position === "static") {
      el.style.position = "relative";
    }
  }

  function renderCard(card) {
    if (!card || card.getAttribute(DONE)) return;
    card.setAttribute(DONE, "1");

    // Mobile: over the image (below the favorite).
    var imgc = card.querySelector(".product-item-image-container");
    if (imgc) {
      ensureRelative(imgc);
      imgc.appendChild(makeEye(card, "mobile"));
    }

    // Desktop: in the info block, next to the product name.
    var info = card.querySelector(".product-item-information");
    if (info) {
      ensureRelative(info);
      info.appendChild(makeEye(card, "desktop"));
    }
  }

  function renderAll(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (scope.matches && scope.matches(CARD)) {
      renderCard(scope);
      return;
    }
    var cards = scope.querySelectorAll(CARD);
    for (var i = 0; i < cards.length; i++) renderCard(cards[i]);
  }

  function init() {
    renderAll(document);
    // Re-process cards added by infinite scroll / AJAX filtering.
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) renderAll(added[j]);
        }
      }
    });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
