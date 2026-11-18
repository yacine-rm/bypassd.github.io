(() => {
  const postList = document.querySelector("[data-post-list]");

  if (postList) {
    const cards = Array.from(postList.querySelectorAll("[data-post-card]"));
    const pagination = document.querySelector("[data-pagination]");
    const previousButton = document.querySelector("[data-page-prev]");
    const nextButton = document.querySelector("[data-page-next]");
    const currentLabel = document.querySelector("[data-page-current]");
    const totalLabel = document.querySelector("[data-page-total]");
    const perPage = 6;
    const totalPages = Math.max(1, Math.ceil(cards.length / perPage));
    let currentPage = 1;

    const renderPage = () => {
      cards.forEach((card, index) => {
        const firstPost = (currentPage - 1) * perPage;
        const lastPost = currentPage * perPage;
        card.hidden = index < firstPost || index >= lastPost;
      });

      if (currentLabel) currentLabel.textContent = String(currentPage);
      if (totalLabel) totalLabel.textContent = String(totalPages);
      if (previousButton) {
        previousButton.disabled = currentPage === 1;
        previousButton.setAttribute("aria-disabled", String(currentPage === 1));
      }
      if (nextButton) {
        nextButton.disabled = currentPage === totalPages;
        nextButton.setAttribute("aria-disabled", String(currentPage === totalPages));
      }
    };

    if (pagination && cards.length > perPage) {
      pagination.hidden = false;

      previousButton?.addEventListener("click", () => {
        if (currentPage <= 1) return;
        currentPage -= 1;
        renderPage();
        postList.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      nextButton?.addEventListener("click", () => {
        if (currentPage >= totalPages) return;
        currentPage += 1;
        renderPage();
        postList.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    renderPage();
  }

  const article = document.querySelector("[data-post-content]");
  const toc = document.querySelector("[data-toc]");

  if (article && toc) {
    const headings = Array.from(article.querySelectorAll("h2, h3"));

    if (headings.length > 0) {
      const links = headings.map((heading, index) => {
        if (!heading.id) heading.id = `section-${index + 1}`;

        const link = document.createElement("a");
        link.href = `#${heading.id}`;
        link.textContent = heading.textContent;
        link.className = heading.tagName === "H3" ? "toc-level-3" : "toc-level-2";
        link.dataset.tocTarget = heading.id;
        toc.appendChild(link);
        return link;
      });

      if ("IntersectionObserver" in window) {
        const linkById = new Map(links.map((link) => [link.dataset.tocTarget, link]));
        const observer = new IntersectionObserver(
          (entries) => {
            const visible = entries.find((entry) => entry.isIntersecting);
            if (!visible) return;
            links.forEach((link) => link.classList.remove("is-active"));
            linkById.get(visible.target.id)?.classList.add("is-active");
          },
          { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
        );

        headings.forEach((heading) => observer.observe(heading));
      }
    }
  }
})();

