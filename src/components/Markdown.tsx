import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

/** 受控的 Markdown 预览（XSS 净化后渲染） */
export function Markdown({ content }: { content: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(content || "*（空文档）*", { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [content]);
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
