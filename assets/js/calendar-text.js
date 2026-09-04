(function (root) {
  "use strict";
  function parse(value) {
    return String(value == null ? "" : value).replace(/\r\n?/g, "\n").split("\n").map(function (line) {
      return line.trim().replace(/^(?:[-*•●▪]\s*|(?:\d+[.、．](?!\d)|[（(][\d一二三四五六七八九十]+[）)]|[一二三四五六七八九十]+[、．])\s*)/, "").trim();
    }).filter(Boolean);
  }
  function expand(events) {
    return (events || []).flatMap(function (event) {
      var lines = parse(event.title);
      return lines.map(function (title, index) {
        return Object.assign({}, event, { title: title, id: lines.length > 1 ? event.id + "-line-" + (index + 1) : event.id });
      });
    });
  }
  var api = { parse: parse, expand: expand };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CalendarText = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
