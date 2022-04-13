(this["webpackJsonphackernews-frontend"]=this["webpackJsonphackernews-frontend"]||[]).push([[0],{33:function(e,t,n){},39:function(e,t,n){},59:function(e,t,n){"use strict";n.r(t);var c=n(2),a=n(24),s=n.n(a),r=(n(31),n(14),n(33),n(7)),o=n.n(r),i=n(12),d=n(5),l=n(4),b=n(26),u=n(8),j=(n(39),n(6)),m=n.n(j),h="https://besthackernews.herokuapp.com/api/v1/",g={getAll:function(e){return e?m.a.get(h+"get?timespan=".concat(e)):m.a.get(h+"get")},getHidden:function(e){var t={headers:{Authorization:"bearer ".concat(e)}};return m.a.get(h+"hidden",t)},addHidden:function(e,t){var n={headers:{Authorization:"bearer ".concat(t)}};return m.a.post(h+"hidden",{hidden:e},n)}},p=function(){var e=Object(i.a)(o.a.mark((function e(t){var n;return o.a.wrap((function(e){for(;;)switch(e.prev=e.next){case 0:return e.next=2,m.a.post("https://besthackernews.herokuapp.com/api/v1/login",t);case 2:return n=e.sent,e.abrupt("return",n.data);case 4:case"end":return e.stop()}}),e)})));return function(t){return e.apply(this,arguments)}}(),O={login:p},f=n(25),x=n.n(f),v=n(10),w=n(0),N=function(e){var t,n=e.story,c=e.addHidden,a=n.url?"https://www.google.com/s2/favicons?domain="+new URL(n.url).hostname:"https://www.google.com/s2/favicons?domain=news.ycombinator.com";return Object(w.jsxs)("div",{className:"bg-light text-dark rounded border-bottom border-right d-flex p-md-3 p-sm-2 px-2 mx-md-3 my-md-1",children:[Object(w.jsxs)("div",{children:[Object(w.jsx)("img",{src:a,alt:"favicon"})," "]})," ",Object(w.jsxs)("div",{className:"px-3",children:[Object(w.jsxs)("a",{href:n.url,children:[" ",n.title," "]})," ",Object(w.jsx)("br",{}),Object(w.jsxs)("small",{children:[Object(w.jsx)(l.a,{icon:v.d})," ",n.by," \xa0\xa0"," ",Object(w.jsx)(l.a,{icon:v.a})," ",x()(n.time).fromNow()]})," "]})," ",Object(w.jsxs)("div",{className:"btn-group btn-group-sm d-flex align-items-center",role:"group",children:[Object(w.jsxs)("a",{href:"#",role:"button",className:"btn btn-outline-secondary",children:[Object(w.jsx)(l.a,{icon:v.c})," ",n.score]})," ",Object(w.jsxs)("a",{href:(t=n.id,"https://news.ycombinator.com/item?id=".concat(t)),className:"btn btn-outline-secondary",children:[Object(w.jsx)(l.a,{icon:v.b})," ",n.descendants]})," ",Object(w.jsxs)("a",{href:"#",role:"button",className:"btn btn-outline-secondary",onClick:function(){return c(n.id)},children:[Object(w.jsx)(l.a,{icon:u.b})," "]})," "]})," "]})},k=function(e){var t=e.stories,n=e.hidden,c=e.addHidden;return(n.length?t.filter((function(e){return!n.includes(e.id)})):t).map((function(e){return Object(w.jsx)(N,{story:e,addHidden:c},e.id)}))},y=function(){var e=Object(c.useState)([]),t=Object(d.a)(e,2),n=t[0],a=t[1],s=Object(c.useState)("Day"),r=Object(d.a)(s,2),j=r[0],m=r[1],h=Object(c.useState)([]),p=Object(d.a)(h,2),f=p[0],x=p[1],v=Object(c.useState)(!1),N=Object(d.a)(v,2),y=N[0],S=N[1],H=Object(c.useState)(""),C=Object(d.a)(H,2),A=C[0],z=C[1],D=Object(c.useState)(""),W=Object(d.a)(D,2),E=W[0],L=W[1],U=Object(c.useState)(!1),I=Object(d.a)(U,2),M=I[0],T=I[1],B=Object(c.useState)(null),J=Object(d.a)(B,2),P=J[0],Y=J[1];Object(c.useEffect)((function(){console.log("fetching stories..."),S(!0),g.getAll(j).then((function(e){console.log("...got them"),a(e.data),S(!1)})).catch((function(e){console.log("didn't get them: ",e),S(!1)}))}),[j]),Object(c.useEffect)((function(){var e=window.localStorage.getItem("loginToken");e&&Y(e)}),[]),Object(c.useEffect)((function(){P&&(console.log("fetching hidden..."),g.getHidden(P).then((function(e){console.log("...got hidden"),x(e.data)})).catch((function(e){console.log("whoopsie:",e),x(null)})))}),[P]);var F=function(){var e=Object(i.a)(o.a.mark((function e(t){var n;return o.a.wrap((function(e){for(;;)switch(e.prev=e.next){case 0:return t.preventDefault(),e.prev=1,e.next=4,O.login({goto:"news",acct:A,pw:E});case 4:(n=e.sent).token?Y(n.token):Y(null),T(!1),z(""),L(""),window.localStorage.setItem("loginToken",n.token),e.next=15;break;case 12:e.prev=12,e.t0=e.catch(1),T(!0);case 15:case"end":return e.stop()}}),e,null,[[1,12]])})));return function(t){return e.apply(this,arguments)}}(),R=function(){return Object(w.jsxs)(w.Fragment,{children:[Object(w.jsx)("button",{className:"btn btn-light",onClick:function(){return m("Day")},children:"Day"}),Object(w.jsx)("button",{className:"btn btn-light",onClick:function(){return m("Week")},children:"Week"}),Object(w.jsx)("button",{className:"btn btn-light",onClick:function(){return m("Month")},children:"Month"}),Object(w.jsx)("button",{className:"btn btn-light",onClick:function(){return m("Year")},children:"Year"}),Object(w.jsx)("button",{className:"btn btn-light",onClick:function(){return m("All")},children:"All"})]})};return Object(w.jsxs)("div",{children:[Object(w.jsxs)("nav",{className:"navbar fixed-top navbar-expand navbar-dark bg-dark d-flex justify-content-start align-items-center",children:[Object(w.jsxs)("div",{className:"navbar-brand h1 m-0 mr-3",children:[Object(w.jsx)(l.a,{icon:b.a,size:"lg",className:"mr-2"}),"Top Hacker News Stories"]}),Object(w.jsxs)("div",{className:"btn-group d-md-none",children:[Object(w.jsx)("button",{className:"btn btn-sm btn-light",type:"button","data-toggle":"dropdown",children:j}),Object(w.jsx)("div",{className:"dropdown-menu dropdown-menu-right",children:Object(w.jsx)("div",{className:"btn-group btn-group-sm",children:R()})})]}),Object(w.jsx)("div",{className:"btn-group btn-group-sm d-none d-md-block",children:R()}),Object(w.jsxs)("div",{className:"btn-group",children:[Object(w.jsx)("a",{className:"btn","data-toggle":"dropdown",href:"#",children:P?Object(w.jsx)(l.a,{icon:u.c,size:"lg",className:"m-auto",inverse:!0}):Object(w.jsx)(l.a,{icon:u.a,size:"lg",className:"m-auto",inverse:!0})}),Object(w.jsx)("div",{className:"dropdown-menu dropdown-menu-right",id:"loginDropdownMenu",children:P?Object(w.jsx)("div",{className:"m-3",children:"Logged in"}):Object(w.jsxs)("form",{className:"px-2",onSubmit:F,children:[Object(w.jsxs)("div",{className:"mb-3 form-group",children:["Username",Object(w.jsx)("input",{type:"text",value:A,name:"Username",onChange:function(e){var t=e.target;return z(t.value)}})]}),Object(w.jsxs)("div",{className:"mb-3 form-group",children:["Password",Object(w.jsx)("input",{type:"password",value:E,name:"Password",onChange:function(e){var t=e.target;return L(t.value)}})]}),Object(w.jsx)("button",{type:"submit",className:"btn-dark btn-md mb-2 form-group",children:"Login"}),M?Object(w.jsx)("div",{className:"mb-3 text-danger",children:"Wrong username/password"}):null,Object(w.jsx)("div",{className:"small form-group",children:Object(w.jsxs)("small",{children:["Use your Hacker News login or"," ",Object(w.jsx)("a",{href:"https://news.ycombinator.com/login",children:"register there"})]})})]})})]})]}),Object(w.jsx)("main",{children:y?Object(w.jsxs)("div",{className:"alert alert-primary align-middle m-3",role:"alert",children:["Loading... ",Object(w.jsx)("div",{className:"spinner-border",role:"status"})]}):Object(w.jsx)(k,{stories:n,hidden:f,addHidden:function(e){console.log("hiding: ",e,":",f);var t=f.concat(e);x(t),P&&g.addHidden(e,P)}})})]})};Boolean("localhost"===window.location.hostname||"[::1]"===window.location.hostname||window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/));s.a.render(Object(w.jsx)(y,{}),document.getElementById("root")),"serviceWorker"in navigator&&navigator.serviceWorker.ready.then((function(e){e.unregister()}))}},[[59,1,2]]]);
//# sourceMappingURL=main.4018bcf9.chunk.js.map