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
  function displayEvents(calendar) {
    var events = expand(calendar.events || []);
    (calendar.dayOverrides || []).forEach(function (day) {
      var title = (day.kind === 'makeup' ? '调课：' : '放假：') + day.note;
      if (!events.some(function (event) { return event.date === day.date && event.title === title; })) {
        events.push({ date: day.date, title: title });
      }
    });
    return events;
  }
  function weekNumber(term, date) {
    if (!term || date < term.startDate || date > term.endDate) return null;
    var week = Math.floor((Date.parse(date + 'T00:00:00Z') - Date.parse(term.weekStartDate + 'T00:00:00Z')) / 604800000) + 1;
    return week >= 1 && week <= term.weekCount ? week : null;
  }
  var api = { parse: parse, expand: expand, displayEvents: displayEvents, weekNumber: weekNumber };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CalendarText = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
