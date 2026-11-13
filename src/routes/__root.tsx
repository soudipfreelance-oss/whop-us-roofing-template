import type { ReactNode } from "react";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import styles from "../styles.css?url";
function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: `!function(w,d,s,u,n,a,b){if(w[n])return;a=w[n]={q:[],t:+new Date,s:[],o:u,track:function(){a.q.push([+new Date].concat([].slice.call(arguments)))},setScope:function(){a.s=[].slice.call(arguments).filter(function(x){return typeof x==="string"});a.q.push([+new Date,"setScope"].concat(a.s))},scope:function(){var c=[].slice.call(arguments);return{track:function(){a.q.push([+new Date].concat([].slice.call(arguments)).concat([{__scope:c}]))}}}};b=d.createElement(s);b.async=1;b.src=u+"/s.js";d.getElementsByTagName(s).parentNode.insertBefore(b,d.getElementsByTagName(s))}(window,document,"script","https://whop.tw","whop");whop.setScope("biz_XJwmVQiE0CA0Kg");whop.track("page");` }} />
      </head>
      <body className="bg-slate-50 text-slate-900 antialiased">{children}<Scripts /></body>
    </html>
  );
}
export const Route = createRootRoute({
  head: () => ({ meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }, { title: "Apex Shield Roofing Co. | Licensed US Roofing Contractor" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: () => <Outlet />,
  shellComponent: RootDocument,
});