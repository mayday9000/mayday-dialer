import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { cn } from "@/lib/utils";

/** Renders markdown (GFM) with readable prose styling. Used for call scripts. */
export function MarkdownView({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        "prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-p:leading-relaxed prose-li:leading-relaxed",
        "prose-strong:text-foreground prose-a:text-primary",
        className,
      )}
    >
      {/* rehype-slug stamps an `id` on every heading so the script section
          browser (lib/script-outline.ts) can jump straight to it. */}
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
