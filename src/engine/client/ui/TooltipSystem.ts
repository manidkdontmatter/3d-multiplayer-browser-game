// Provides a global themed tooltip layer that skins native title-based tooltips across the client UI.
export class TooltipSystem {
  private static installed = false;
  private readonly tooltipNode: HTMLDivElement;
  private readonly originalTitleByElement = new WeakMap<HTMLElement, string>();
  private activeElement: HTMLElement | null = null;

  private constructor(private readonly documentRef: Document) {
    this.tooltipNode = documentRef.createElement("div");
    this.tooltipNode.id = "global-tooltip";
    this.tooltipNode.className = "global-tooltip";
    this.tooltipNode.setAttribute("role", "tooltip");
    documentRef.body.append(this.tooltipNode);
    documentRef.addEventListener("mouseover", this.onMouseOver, true);
    documentRef.addEventListener("mousemove", this.onMouseMove, true);
    documentRef.addEventListener("mouseout", this.onMouseOut, true);
    documentRef.addEventListener("focusin", this.onFocusIn, true);
    documentRef.addEventListener("focusout", this.onFocusOut, true);
    window.addEventListener("blur", this.onWindowBlur);
  }

  public static install(documentRef: Document): void {
    if (TooltipSystem.installed) {
      return;
    }
    TooltipSystem.installed = true;
    new TooltipSystem(documentRef);
  }

  private readonly onMouseOver = (event: MouseEvent): void => {
    const tooltipTarget = this.resolveTooltipTarget(event.target);
    if (!tooltipTarget) {
      return;
    }
    this.showTooltip(tooltipTarget, event.clientX, event.clientY);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.activeElement) {
      return;
    }
    this.positionTooltip(event.clientX, event.clientY);
  };

  private readonly onMouseOut = (event: MouseEvent): void => {
    if (!this.activeElement) {
      return;
    }
    const leavingTarget = event.target;
    if (!(leavingTarget instanceof Node) || !this.activeElement.contains(leavingTarget)) {
      return;
    }
    const related = event.relatedTarget;
    if (related instanceof Node && this.activeElement.contains(related)) {
      return;
    }
    this.hideTooltip();
  };

  private readonly onFocusIn = (event: FocusEvent): void => {
    const tooltipTarget = this.resolveTooltipTarget(event.target);
    if (!tooltipTarget) {
      return;
    }
    const rect = tooltipTarget.getBoundingClientRect();
    this.showTooltip(tooltipTarget, rect.left + rect.width * 0.5, rect.top - 10);
  };

  private readonly onFocusOut = (): void => {
    this.hideTooltip();
  };

  private readonly onWindowBlur = (): void => {
    this.hideTooltip();
  };

  private resolveTooltipTarget(source: EventTarget | null): HTMLElement | null {
    let current: Element | null = source instanceof Element ? source : null;
    while (current) {
      if (current instanceof HTMLElement) {
        const customText = current.getAttribute("data-ui-tooltip");
        if (typeof customText === "string" && customText.trim().length > 0) {
          return current;
        }
        const titleText = current.getAttribute("title");
        if (typeof titleText === "string" && titleText.trim().length > 0) {
          return current;
        }
      }
      current = current.parentElement;
    }
    return null;
  }

  private showTooltip(target: HTMLElement, x: number, y: number): void {
    const text = this.readTooltipText(target);
    if (!text) {
      this.hideTooltip();
      return;
    }
    this.captureTitle(target);
    this.activeElement = target;
    this.tooltipNode.textContent = text;
    this.tooltipNode.classList.add("global-tooltip-visible");
    this.positionTooltip(x, y);
  }

  private hideTooltip(): void {
    if (this.activeElement) {
      this.restoreTitle(this.activeElement);
    }
    this.activeElement = null;
    this.tooltipNode.classList.remove("global-tooltip-visible");
    this.tooltipNode.textContent = "";
  }

  private readTooltipText(target: HTMLElement): string {
    const customText = target.getAttribute("data-ui-tooltip");
    if (typeof customText === "string" && customText.trim().length > 0) {
      return customText.trim();
    }
    const titleText = target.getAttribute("title");
    if (typeof titleText === "string" && titleText.trim().length > 0) {
      return titleText.trim();
    }
    const cachedTitle = this.originalTitleByElement.get(target);
    if (typeof cachedTitle === "string" && cachedTitle.trim().length > 0) {
      return cachedTitle.trim();
    }
    return "";
  }

  private captureTitle(target: HTMLElement): void {
    const titleText = target.getAttribute("title");
    if (typeof titleText !== "string" || titleText.trim().length === 0) {
      return;
    }
    this.originalTitleByElement.set(target, titleText);
    target.removeAttribute("title");
  }

  private restoreTitle(target: HTMLElement): void {
    const cachedTitle = this.originalTitleByElement.get(target);
    if (typeof cachedTitle !== "string" || cachedTitle.trim().length === 0) {
      return;
    }
    target.setAttribute("title", cachedTitle);
  }

  private positionTooltip(anchorX: number, anchorY: number): void {
    const node = this.tooltipNode;
    const margin = 12;
    const offsetX = 14;
    const offsetY = 16;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = anchorX + offsetX;
    let top = anchorY + offsetY;

    if (left + width + margin > viewportWidth) {
      left = Math.max(margin, anchorX - width - offsetX);
    }
    if (top + height + margin > viewportHeight) {
      top = Math.max(margin, anchorY - height - offsetY);
    }

    node.style.left = `${Math.max(margin, left)}px`;
    node.style.top = `${Math.max(margin, top)}px`;
  }
}

