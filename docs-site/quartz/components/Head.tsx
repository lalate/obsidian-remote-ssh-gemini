import { i18n } from "../i18n"
import { FullSlug, getFileExtension, joinSegments, pathToRoot } from "../util/path"
import { CSSResourceToStyleElement, JSResourceToScriptElement } from "../util/resources"
import { googleFontHref, googleFontSubsetHref } from "../util/theme"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { unescapeHTML } from "../util/escape"
import { CustomOgImagesEmitterName } from "../plugins/emitters/ogImage"
export default (() => {
  const Head: QuartzComponent = ({
    cfg,
    fileData,
    externalResources,
    ctx,
    allFiles,
  }: QuartzComponentProps) => {
    const titleSuffix = cfg.pageTitleSuffix ?? ""
    const title =
      (fileData.frontmatter?.title ?? i18n(cfg.locale).propertyDefaults.title) + titleSuffix
    const description =
      fileData.frontmatter?.socialDescription ??
      fileData.frontmatter?.description ??
      unescapeHTML(fileData.description?.trim() ?? i18n(cfg.locale).propertyDefaults.description)

    const { css, js, additionalHead } = externalResources

    const url = new URL(`https://${cfg.baseUrl ?? "example.com"}`)
    const path = url.pathname as FullSlug
    const baseDir = fileData.slug === "404" ? path : pathToRoot(fileData.slug!)
    const iconPath = joinSegments(baseDir, "static/icon.png")

    // Canonical + dev-noindex handling.
    //
    // Two builds publish from the same source: the stable site (root of
    // gh-pages) and the dev preview (gh-pages/dev/). The dev preview
    // must not compete with stable in SERPs — it's a staging surface,
    // not authoritative content. Two-step defence:
    //
    //   1. <link rel="canonical"> always points at the stable URL, with
    //      any "/dev" suffix stripped from baseUrl. So even if a dev
    //      page gets crawled, the search engine is told the real
    //      authority lives at the stable URL.
    //   2. On dev builds we additionally emit <meta robots noindex,
    //      follow> so crawlers skip indexing dev pages entirely while
    //      still propagating internal-link equity to anything we link.
    const isDev = (cfg.baseUrl ?? "").includes("/dev")
    const canonicalBaseUrl = isDev
      ? (cfg.baseUrl ?? "").replace(/\/dev\/?$/, "")
      : (cfg.baseUrl ?? "")
    const canonicalUrl =
      fileData.slug === "404"
        ? `https://${canonicalBaseUrl}/`
        : `https://${joinSegments(canonicalBaseUrl, fileData.slug!)}`

    // og:url / twitter:url / twitter:domain mirror canonical so social
    // shares of dev pages don't carry dev URLs into the wider web. (The
    // robots noindex on dev keeps Google away, but social platforms
    // don't honour noindex; without aligning here, a Twitter or Discord
    // share of a /dev/ page would link followers back to staging.)
    const socialUrl = canonicalUrl
    const socialDomain = canonicalBaseUrl

    // JSON-LD structured data (schema.org).
    //
    // Selected via `schema:` frontmatter field. Currently supported:
    //
    //   - "SoftwareApplication" — for the project's home/landing pages.
    //     Auto-fills name, description, url from page metadata; the
    //     remaining fields (category, OS, offer, download URL) are
    //     static project facts.
    //
    //   - "FAQPage" — requires a `faq:` array of {q, a} objects in
    //     frontmatter. Each becomes a Question/Answer pair in the
    //     mainEntity. Google uses this to render People-Also-Ask
    //     boxes in SERPs.
    //
    // Other types (HowTo for cookbooks, TechArticle for architecture
    // pages) can be added here as we extend coverage.
    const schemaType = fileData.frontmatter?.schema as string | undefined
    let jsonLdBlob: Record<string, unknown> | null = null

    // Project author + publisher used across schema blobs. Matches
    // plugin/manifest.json's author + authorUrl so the docs site,
    // the Obsidian Community Plugins listing, and BRAT all attribute
    // the project to the same Person identity. Critical for E-E-A-T
    // signalling on Article + TechArticle (Google's 2024 update made
    // author the load-bearing field for topical authority).
    const projectAuthor = {
      "@type": "Person",
      name: "souta shimozono",
      url: "https://codes.sota-shimozono.com/",
    }

    if (schemaType === "SoftwareApplication") {
      jsonLdBlob = {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: cfg.pageTitle ?? "obsidian-remote-ssh",
        description,
        url: canonicalUrl,
        applicationCategory: "ProductivityApplication",
        operatingSystem: "Linux, macOS, Windows",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        downloadUrl:
          "https://github.com/sotashimozono/obsidian-remote-ssh/releases/latest",
        author: projectAuthor,
      }
    } else if (schemaType === "Article" || schemaType === "TechArticle") {
      // Article + TechArticle share most of the same shape. We auto-fill
      // headline/description/url/dates/inLanguage from page metadata so
      // the per-page frontmatter only has to carry `schema: Article` (or
      // `schema: TechArticle`) — no other fields required.
      const dates = (fileData.dates ?? {}) as {
        published?: Date
        modified?: Date
        created?: Date
      }
      const headline = (fileData.frontmatter?.title ?? "") as string
      const lang = (fileData.frontmatter?.lang as string | undefined) ?? "en"
      const articleBlob: Record<string, unknown> = {
        "@context": "https://schema.org",
        "@type": schemaType,
        headline,
        description,
        url: canonicalUrl,
        inLanguage: lang,
        isPartOf: {
          "@type": "WebSite",
          name: cfg.pageTitle ?? "obsidian-remote-ssh",
          url: `https://${canonicalBaseUrl}/`,
        },
        author: projectAuthor,
        publisher: projectAuthor,
      }
      if (dates.published) {
        articleBlob.datePublished = dates.published.toISOString()
      } else if (dates.created) {
        articleBlob.datePublished = dates.created.toISOString()
      }
      if (dates.modified) {
        articleBlob.dateModified = dates.modified.toISOString()
      }
      jsonLdBlob = articleBlob
    } else if (schemaType === "FAQPage") {
      const faqItems = fileData.frontmatter?.faq as
        | Array<{ q: string; a: string }>
        | undefined
      if (faqItems && faqItems.length > 0) {
        jsonLdBlob = {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqItems.map(({ q, a }) => ({
            "@type": "Question",
            name: q,
            acceptedAnswer: {
              "@type": "Answer",
              text: a,
            },
          })),
          author: projectAuthor,
        }
      }
    }

    // Hreflang alternates for EN/JA twins.
    //
    // Convention: pages under `docs/<lang>/<rest>` slug to `<lang>/<rest>`
    // (e.g. `en/migration/from-obsidian-sync` and `ja/migration/from-obsidian-sync`).
    // When both twins exist, Google needs reciprocal `rel="alternate"
    // hreflang="..."` links on each so the right language version is
    // surfaced for each user's locale. Without these, both twins compete
    // as duplicates and Google may pick whichever it first crawled.
    //
    // Detection is convention-based: parse the slug for an `en/` or
    // `ja/` prefix, build the twin slug by swapping the prefix, and
    // check the in-memory `allFiles` list for the twin. If found, emit
    // self-hreflang + twin-hreflang + x-default (pointing at EN).
    //
    // Pages outside the per-language subtree (e.g. `index`, `tags/*`,
    // `404`) get no hreflang — correct, since they have no language
    // siblings to disambiguate against.
    const slug = fileData.slug ?? ""
    const langTwinMatch = slug.match(/^(en|ja)\/(.+)$/)
    const hreflangAlternates: Array<{ hrefLang: string; href: string }> = []
    if (langTwinMatch) {
      const [, currentLang, restPath] = langTwinMatch
      const otherLang = currentLang === "en" ? "ja" : "en"
      const twinSlug = `${otherLang}/${restPath}`
      const twinExists = allFiles.some((f) => f.slug === twinSlug)
      if (twinExists) {
        const selfHref = canonicalUrl
        const twinHref = `https://${joinSegments(canonicalBaseUrl, twinSlug)}`
        const enHref = currentLang === "en" ? selfHref : twinHref
        hreflangAlternates.push(
          { hrefLang: currentLang, href: selfHref },
          { hrefLang: otherLang, href: twinHref },
          // x-default points at the EN copy by convention.
          { hrefLang: "x-default", href: enHref },
        )
      }
    }

    const usesCustomOgImage = ctx.cfg.plugins.emitters.some(
      (e) => e.name === CustomOgImagesEmitterName,
    )
    const ogImageDefaultPath = `https://${cfg.baseUrl}/static/og-image.png`

    return (
      <head>
        <title>{title}</title>
        <meta charSet="utf-8" />
        {cfg.theme.cdnCaching && cfg.theme.fontOrigin === "googleFonts" && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" />
            <link rel="stylesheet" href={googleFontHref(cfg.theme)} />
            {cfg.theme.typography.title && (
              <link rel="stylesheet" href={googleFontSubsetHref(cfg.theme, cfg.pageTitle)} />
            )}
          </>
        )}
        <link rel="preconnect" href="https://cdnjs.cloudflare.com" crossOrigin="anonymous" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />

        <meta name="og:site_name" content={cfg.pageTitle}></meta>
        <meta property="og:title" content={title} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content="@sotashimozono" />
        <meta name="twitter:creator" content="@sotashimozono" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta property="og:description" content={description} />
        <meta property="og:image:alt" content={description} />

        {!usesCustomOgImage && (
          <>
            <meta property="og:image" content={ogImageDefaultPath} />
            <meta property="og:image:url" content={ogImageDefaultPath} />
            <meta name="twitter:image" content={ogImageDefaultPath} />
            <meta
              property="og:image:type"
              content={`image/${getFileExtension(ogImageDefaultPath) ?? "png"}`}
            />
          </>
        )}

        {cfg.baseUrl && (
          <>
            <meta property="twitter:domain" content={socialDomain}></meta>
            <meta property="og:url" content={socialUrl}></meta>
            <meta property="twitter:url" content={socialUrl}></meta>
          </>
        )}

        <link rel="icon" href={iconPath} />
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />
        {isDev && <meta name="robots" content="noindex, follow" />}
        {hreflangAlternates.map(({ hrefLang, href }) => (
          <link rel="alternate" hrefLang={hrefLang} href={href} key={hrefLang} />
        ))}
        {jsonLdBlob && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              // Escape `<` to its JSON unicode form so a stray
              // "</script>" sequence inside any string field (description,
              // FAQ answer, etc.) cannot break out of the surrounding
              // <script> element. JSON.stringify itself does not do this.
              __html: JSON.stringify(jsonLdBlob).replace(/</g, "\\u003c"),
            }}
          />
        )}
        <meta name="generator" content="Quartz" />

        {css.map((resource) => CSSResourceToStyleElement(resource, true))}
        {js
          .filter((resource) => resource.loadTime === "beforeDOMReady")
          .map((res) => JSResourceToScriptElement(res, true))}
        {additionalHead.map((resource) => {
          if (typeof resource === "function") {
            return resource(fileData)
          } else {
            return resource
          }
        })}
      </head>
    )
  }

  return Head
}) satisfies QuartzComponentConstructor
