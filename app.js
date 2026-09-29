const regionCatalog = [
  ["서울특별시", "서울"], ["부산광역시", "부산"], ["대구광역시", "대구"],
  ["인천광역시", "인천"], ["광주광역시", "광주"], ["대전광역시", "대전"],
  ["울산광역시", "울산"], ["세종특별자치시", "세종"], ["경기도", "경기"],
  ["강원도", "강원"], ["충청북도", "충북"], ["충청남도", "충남"],
  ["전라북도", "전북"], ["전라남도", "전남"], ["경상북도", "경북"],
  ["경상남도", "경남"], ["제주특별자치도", "제주"]
];
const regions = regionCatalog.map(([name, short]) => ({ name, short }));
const modeKeys = ["rail", "express", "intercity"];
const modeLabels = { rail: "철도", express: "고속버스", intercity: "시외버스" };
const modeColors = { rail: "#66d9ff", express: "#a58bff", intercity: "#55e6b2" };
const causeKeys = ["visitor", "smoking", "burning", "other"];
const causeLabels = { visitor: "입산자 실화", smoking: "담뱃불", burning: "소각", other: "기타" };
const fireRegionAliases = {
  "서울": "서울특별시", "부산": "부산광역시", "대구": "대구광역시", "인천": "인천광역시",
  "광주": "광주광역시", "전남광주": "광주광역시", "대전": "대전광역시", "울산": "울산광역시",
  "세종": "세종특별자치시", "경기": "경기도", "강원": "강원도", "충북": "충청북도",
  "충남": "충청남도", "전북": "전라북도", "전남": "전라남도", "경북": "경상북도",
  "경남": "경상남도", "제주": "제주특별자치도"
};

const state = {
  month: 0,
  modes: new Set(modeKeys),
  direction: "outflow",
  cause: "all",
  selected: "강원도",
  metric: "fires",
  mapTransform: d3.zoomIdentity
};

let geoData;
let renderFrame;
let mapSvg;
let mapZoomBehavior;
let months = [];
let trafficRecords = [];
let fireRecords = [];
let trafficByPeriod = new Map();
let fireByPeriodRegion = new Map();
const byName = new Map(regions.map(d => [d.name, d]));
const tooltip = d3.select("#tooltip");

function fireCauseKey(cause) {
  if (cause.includes("입산")) return "visitor";
  if (cause.includes("담뱃불")) return "smoking";
  if (cause.includes("소각") || cause.includes("논·밭두렁")) return "burning";
  return "other";
}

function formatPeriod(period) {
  const [year, month] = period.split("-");
  return `${year}년 ${Number(month)}월`;
}

function rowFor(region, month = state.month, cause = state.cause, direction = state.direction) {
  const period = months[month];
  const routes = trafficByPeriod.get(period) ?? [];
  const trafficValue = d3.sum(routes, route => {
    const matches = direction === "inflow" ? route.target === region.name : route.source === region.name;
    if (!matches) return 0;
    return d3.sum(modeKeys, key => state.modes.has(key) ? route[key] : 0);
  });
  const incidents = (fireByPeriodRegion.get(period)?.get(region.name) ?? [])
    .filter(record => cause === "all" || record.causeKey === cause);
  return {
    ...region,
    trafficValue,
    fireValue: incidents.length,
    areaValue: d3.sum(incidents, record => record.damagearea)
  };
}

function allRows(month = state.month, cause = state.cause, direction = state.direction) {
  return regions.map(region => rowFor(region, month, cause, direction));
}

function incidentsFor(period, regionName = null) {
  const byRegion = fireByPeriodRegion.get(period);
  if (!byRegion) return [];
  if (regionName) return byRegion.get(regionName) ?? [];
  return [...byRegion.values()].flat();
}

function routeValues(month = state.month) {
  const period = months[month];
  const routes = trafficByPeriod.get(period) ?? [];
  return routes.flatMap(route => modeKeys
    .filter(mode => state.modes.has(mode) && route[mode] > 0)
    .map(mode => ({ source: route.source, target: route.target, mode, value: route[mode] })))
    .sort((a, b) => b.value - a.value);
}

function formatTraffic(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}백만 건`;
  if (value >= 10000) return `${(value / 10000).toFixed(1)}만 건`;
  return `${Math.round(value).toLocaleString("ko-KR")}건`;
}

function shortName(name) {
  return byName.get(name)?.short || name.replace(/특별자치|광역|특별/g, "").replace(/시$|도$/, "");
}

function showTooltip(event, html) {
  tooltip.html(html).attr("hidden", null);
  const box = tooltip.node().getBoundingClientRect();
  const left = Math.min(event.clientX + 16, window.innerWidth - box.width - 12);
  const top = Math.max(12, Math.min(event.clientY + 14, window.innerHeight - box.height - 12));
  tooltip.style("left", `${left}px`).style("top", `${top}px`);
}

function hideTooltip() {
  tooltip.attr("hidden", true);
}

function chooseRegion(name) {
  state.selected = name;
  document.querySelector("#regionSelect").value = name || "all";
  renderAll();
}

function setupControls() {
  const monthSelect = document.querySelector("#monthSelect");
  months.forEach((period, index) => monthSelect.add(new Option(formatPeriod(period), index)));
  monthSelect.value = state.month;

  const regionSelect = document.querySelector("#regionSelect");
  regionSelect.add(new Option("전국", "all"));
  regions.forEach(region => regionSelect.add(new Option(region.name, region.name)));
  regionSelect.value = state.selected;

  monthSelect.addEventListener("change", event => {
    chooseMonth(Number(event.target.value));
  });

  document.querySelector("#causeSelect").addEventListener("change", event => {
    state.cause = event.target.value;
    renderAll();
  });

  document.querySelectorAll('.mode-filter input[type="checkbox"]').forEach(input => {
    input.addEventListener("change", event => {
      if (event.target.checked) state.modes.add(event.target.value);
      else state.modes.delete(event.target.value);
      if (!state.modes.size) {
        state.modes.add(event.target.value);
        event.target.checked = true;
      }
      renderAll();
    });
  });

  document.querySelectorAll('.direction-filter input[type="radio"]').forEach(input => {
    input.addEventListener("change", event => {
      if (!event.target.checked) return;
      state.direction = event.target.value;
      renderAll();
    });
  });

  regionSelect.addEventListener("change", event => chooseRegion(event.target.value === "all" ? null : event.target.value));

  document.querySelector("#metricButton").addEventListener("click", () => {
    state.metric = state.metric === "fires" ? "area" : "fires";
    document.querySelector("#metricButton").textContent = state.metric === "fires" ? "피해면적 보기" : "발생건수 보기";
    renderScatter();
  });

  document.querySelector("#mapZoomIn").addEventListener("click", () => zoomMap(1.45));
  document.querySelector("#mapZoomOut").addEventListener("click", () => zoomMap(1 / 1.45));
  document.querySelector("#mapZoomReset").addEventListener("click", resetMapZoom);
  document.querySelector("#mapExpandButton").addEventListener("click", toggleMapExpansion);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && document.querySelector(".map-panel").classList.contains("is-expanded")) toggleMapExpansion();
  });

}

function setupEntryScreen() {
  const entry = document.querySelector("#entryScreen");
  const dashboard = document.querySelector("#dashboardContent");
  let burning = false;
  const enterDashboard = () => {
    if (burning) return;
    burning = true;
    entry.classList.add("is-burning");
    entry.removeAttribute("tabindex");
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 20 : 1650;
    window.setTimeout(() => {
      entry.hidden = true;
      document.body.classList.remove("entry-active");
      dashboard.removeAttribute("inert");
      dashboard.setAttribute("aria-hidden", "false");
      window.scrollTo({ top: 0, behavior: "auto" });
    }, delay);
  };
  entry.addEventListener("click", enterDashboard);
  entry.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    enterDashboard();
  });
}

function zoomMap(factor) {
  if (!mapSvg || !mapZoomBehavior) return;
  mapSvg.transition().duration(220).call(mapZoomBehavior.scaleBy, factor);
}

function resetMapZoom() {
  state.mapTransform = d3.zoomIdentity;
  if (mapSvg && mapZoomBehavior) mapSvg.transition().duration(260).call(mapZoomBehavior.transform, d3.zoomIdentity);
}

function toggleMapExpansion() {
  const panel = document.querySelector(".map-panel");
  const button = document.querySelector("#mapExpandButton");
  const expanded = !panel.classList.contains("is-expanded");
  panel.classList.toggle("is-expanded", expanded);
  document.body.classList.toggle("has-expanded-map", expanded);
  button.setAttribute("aria-pressed", String(expanded));
  button.querySelector(".expand-label").textContent = expanded ? "원래 크기로" : "지도 크게 보기";
  requestAnimationFrame(renderMap);
}

function chooseMonth(month) {
  state.month = month;
  document.querySelector("#monthSelect").value = month;
  hideTooltip();
  renderAll();
}

function renderAll() {
  syncDirectionLabels();
  document.querySelector("#monthLabel").textContent = formatPeriod(months[state.month]);
  document.querySelector("#trackFill").style.width = `${((state.month + 1) / months.length) * 100}%`;
  renderMap();
  renderScatter();
  renderCorrelation();
  renderDetails();
}

function syncDirectionLabels() {
  const word = state.direction === "inflow" ? "유입" : "유출";
  document.querySelector("#mapDirectionLabel").textContent = `지역 ${word} 교통`;
  document.querySelector("#scatterDirectionLabel").textContent = `${word} 교통량`;
  document.querySelector("#mapLegendDirection").textContent = `${word} 교통`;
  document.querySelector("#corrDirectionLabel").textContent = word;
  document.querySelector("#corrCopy").textContent = `선택 지역의 공통 기간 ${months.length}개월 ${word} 교통량과 산불 발생을 비교합니다.`;
  document.querySelector("#trafficMetricLabel").textContent = `월간 ${word}`;
  document.querySelector("#routeEyebrow").textContent = `주요 ${word}`;
  document.querySelector("#routeTitle").textContent = state.direction === "inflow" ? "지역으로 들어온 경로" : "지역을 벗어난 경로";
}

function renderMap() {
  if (!geoData) return;
  const host = document.querySelector("#mapChart");
  const width = Math.max(host.clientWidth, 560);
  const height = Math.max(host.clientHeight, 480);
  const rows = allRows();
  const rowMap = new Map(rows.map(d => [d.name, d]));
  const trafficMax = d3.max(rows, d => d.trafficValue) || 1;
  const fireMax = d3.max(rows, d => d.areaValue) || 1;
  const projection = d3.geoMercator().fitExtent([[28, 22], [width - 28, height - 28]], geoData);
  const path = d3.geoPath(projection);
  const fill = d3.scaleSequential().domain([0, trafficMax]).interpolator(t => d3.interpolateRgb("#101f32", "#17608a")(Math.pow(t, 0.7)));
  const fireRadius = d3.scaleSqrt().domain([0, fireMax]).range([0, 15]);
  const svg = d3.select(host).selectAll("svg").data([null]).join("svg").attr("viewBox", `0 0 ${width} ${height}`);
  svg.selectAll("*").remove();

  const defs = svg.append("defs");
  Object.entries(modeColors).forEach(([mode, color]) => {
    defs.append("marker")
      .attr("id", `arrow-${mode}`)
      .attr("viewBox", "0 -4 8 8")
      .attr("refX", 7)
      .attr("refY", 0)
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .attr("orient", "auto")
      .append("path").attr("d", "M0,-3L8,0L0,3").attr("fill", color).attr("opacity", 0.82);
  });

  const features = geoData.features.filter(feature => rowMap.has(feature.properties.name));
  const centroid = new Map(features.map(feature => [feature.properties.name, path.centroid(feature)]));
  const zoomLayer = svg.append("g").attr("class", "map-zoom-layer");
  mapZoomBehavior = d3.zoom()
    .scaleExtent([1, 6])
    .on("zoom", event => {
      state.mapTransform = event.transform;
      zoomLayer.attr("transform", event.transform);
    });
  mapSvg = svg.call(mapZoomBehavior).on("dblclick.zoom", null);
  mapSvg.call(mapZoomBehavior.transform, state.mapTransform);

  zoomLayer.append("g").selectAll("path")
    .data(features)
    .join("path")
    .attr("class", feature => `province ${state.selected === feature.properties.name ? "is-selected" : ""}`)
    .attr("d", path)
    .attr("fill", feature => fill(rowMap.get(feature.properties.name).trafficValue))
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", feature => `${feature.properties.name} 선택`)
    .on("click", (_, feature) => chooseRegion(feature.properties.name))
    .on("keydown", (event, feature) => { if (event.key === "Enter" || event.key === " ") chooseRegion(feature.properties.name); })
    .on("mousemove", (event, feature) => {
      const row = rowMap.get(feature.properties.name);
      const direction = state.direction === "inflow" ? "유입" : "유출";
      showTooltip(event, `<b>${feature.properties.name}</b><span>${direction} 교통 ${formatTraffic(row.trafficValue)}</span><span>산불 ${Math.round(row.fireValue)}건 · ${row.areaValue.toFixed(1)}ha</span>`);
    })
    .on("mouseleave", hideTooltip);

  const routePool = state.selected
    ? state.direction === "inflow"
      ? routeValues().filter(route => route.target === state.selected)
      : routeValues().filter(route => route.source === state.selected)
    : routeValues();
  const visibleRoutes = routePool.filter(route => centroid.has(route.source) && centroid.has(route.target)).sort((a, b) => b.value - a.value).slice(0, state.selected ? 9 : 20);
  const routeWidth = d3.scaleSqrt().domain([0, d3.max(visibleRoutes, d => d.value) || 1]).range([0.8, 6]);
  zoomLayer.append("g").attr("class", "flows").selectAll("path")
    .data(visibleRoutes)
    .join("path")
    .attr("class", "flow-line")
    .attr("d", route => {
      const [x1, y1] = centroid.get(route.source);
      const [x2, y2] = centroid.get(route.target);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const bend = Math.min(34, Math.hypot(dx, dy) * 0.18);
      const mx = (x1 + x2) / 2 - (dy / Math.max(Math.hypot(dx, dy), 1)) * bend;
      const my = (y1 + y2) / 2 + (dx / Math.max(Math.hypot(dx, dy), 1)) * bend;
      return `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
    })
    .attr("stroke", route => modeColors[route.mode])
    .attr("stroke-width", route => routeWidth(route.value))
    .attr("marker-end", route => `url(#arrow-${route.mode})`)
    .on("mousemove", (event, route) => showTooltip(event, `<b>${shortName(route.source)} → ${shortName(route.target)}</b><span>${modeLabels[route.mode]} · ${formatTraffic(route.value)}</span>`))
    .on("mouseleave", hideTooltip);

  zoomLayer.append("g").attr("class", "fire-points").selectAll("circle")
    .data(rows.filter(row => centroid.has(row.name)))
    .join("circle")
    .attr("class", row => `fire-point ${state.selected === row.name ? "is-selected" : ""}`)
    .attr("cx", row => centroid.get(row.name)[0] + Math.sin(row.name.length * 2.3) * 5)
    .attr("cy", row => centroid.get(row.name)[1] + Math.cos(row.name.length * 1.7) * 5)
    .attr("r", row => fireRadius(row.areaValue))
    .on("click", (_, row) => chooseRegion(row.name))
    .on("mousemove", (event, row) => showTooltip(event, `<b>${row.name}</b><span>산불 ${Math.round(row.fireValue)}건</span><span>피해 ${row.areaValue.toFixed(1)}ha</span>`))
    .on("mouseleave", hideTooltip);

  const labels = rows.filter(row => state.selected === row.name || ["서울특별시", "강원도", "경상북도", "부산광역시", "전라남도", "제주특별자치도"].includes(row.name));
  zoomLayer.append("g").attr("class", "map-labels").selectAll("text")
    .data(labels.filter(row => centroid.has(row.name)))
    .join("text")
    .attr("x", row => centroid.get(row.name)[0])
    .attr("y", row => centroid.get(row.name)[1] - fireRadius(row.areaValue) - 7)
    .attr("text-anchor", "middle")
    .attr("class", row => state.selected === row.name ? "is-selected" : null)
    .text(row => row.short);
}

function renderScatter() {
  const host = document.querySelector("#scatterChart");
  const width = Math.max(host.clientWidth, 430);
  const height = Math.max(host.clientHeight, 440);
  const margin = { top: 32, right: 26, bottom: 58, left: 62 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const rows = allRows();
  const yKey = state.metric === "fires" ? "fireValue" : "areaValue";
  const xMedian = d3.median(rows, d => d.trafficValue);
  const yMedian = d3.median(rows, d => d[yKey]);
  const x = d3.scaleLinear().domain([0, d3.max(rows, d => d.trafficValue) * 1.08]).nice().range([0, innerWidth]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, d => d[yKey]) * 1.12]).nice().range([innerHeight, 0]);
  const radius = d3.scaleSqrt().domain([0, d3.max(rows, d => d.areaValue)]).range([5, 14]);
  const svg = d3.select(host).selectAll("svg").data([null]).join("svg").attr("viewBox", `0 0 ${width} ${height}`);
  svg.selectAll("*").remove();
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const gridX = d3.axisBottom(x).ticks(5).tickSize(-innerHeight).tickFormat("");
  const gridY = d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat("");
  g.append("g").attr("class", "chart-grid").attr("transform", `translate(0,${innerHeight})`).call(gridX);
  g.append("g").attr("class", "chart-grid").call(gridY);

  g.append("line").attr("class", "median-line").attr("x1", x(xMedian)).attr("x2", x(xMedian)).attr("y1", 0).attr("y2", innerHeight);
  g.append("line").attr("class", "median-line").attr("x1", 0).attr("x2", innerWidth).attr("y1", y(yMedian)).attr("y2", y(yMedian));

  const quadrants = [
    { x: innerWidth - 8, y: 17, anchor: "end", text: "이동 많음 · 산불 많음" },
    { x: 8, y: 17, anchor: "start", text: "이동 적음 · 산불 많음" },
    { x: innerWidth - 8, y: innerHeight - 10, anchor: "end", text: "이동 많음 · 산불 적음" },
    { x: 8, y: innerHeight - 10, anchor: "start", text: "이동 적음 · 산불 적음" }
  ];
  g.append("g").selectAll("text").data(quadrants).join("text")
    .attr("class", "quadrant-label").attr("x", d => d.x).attr("y", d => d.y).attr("text-anchor", d => d.anchor).text(d => d.text);

  g.append("g").attr("class", "x-axis").attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(value => value >= 1000000 ? `${(value / 1000000).toFixed(1)}M` : value >= 1000 ? `${Math.round(value / 1000)}k` : value));
  g.append("g").attr("class", "y-axis").call(d3.axisLeft(y).ticks(5));
  const direction = state.direction === "inflow" ? "유입" : "유출";
  g.append("text").attr("class", "axis-title").attr("x", innerWidth / 2).attr("y", innerHeight + 48).attr("text-anchor", "middle").text(`월간 지역 교통 ${direction}량`);
  g.append("text").attr("class", "axis-title").attr("transform", "rotate(-90)").attr("x", -innerHeight / 2).attr("y", -46).attr("text-anchor", "middle").text(state.metric === "fires" ? "산불 발생 건수" : "산불 피해면적 (ha)");

  g.append("g").selectAll("circle")
    .data(rows)
    .join("circle")
    .attr("class", row => `scatter-dot ${state.selected === row.name ? "is-selected" : ""}`)
    .attr("cx", row => x(row.trafficValue))
    .attr("cy", row => y(row[yKey]))
    .attr("r", row => radius(row.areaValue))
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", row => `${row.name} 선택`)
    .on("click", (_, row) => chooseRegion(row.name))
    .on("keydown", (event, row) => { if (event.key === "Enter" || event.key === " ") chooseRegion(row.name); })
    .on("mousemove", (event, row) => showTooltip(event, `<b>${row.name}</b><span>${direction} 교통 ${formatTraffic(row.trafficValue)}</span><span>${state.metric === "fires" ? `산불 ${Math.round(row.fireValue)}건` : `피해 ${row.areaValue.toFixed(1)}ha`}</span>`))
    .on("mouseleave", hideTooltip);

  const labelRows = rows.filter(row => state.selected === row.name || row.trafficValue > xMedian * 1.5 || row[yKey] > yMedian * 1.65);
  g.append("g").selectAll("text").data(labelRows).join("text")
    .attr("class", row => `point-label ${state.selected === row.name ? "is-selected" : ""}`)
    .attr("x", row => x(row.trafficValue) + radius(row.areaValue) + 5)
    .attr("y", row => y(row[yKey]) - 4)
    .text(row => row.short);
}

function correlationLabel(value) {
  const strength = Math.abs(value) >= 0.7 ? "강한" : Math.abs(value) >= 0.4 ? "보통" : Math.abs(value) >= 0.2 ? "약한" : "거의 없는";
  if (Math.abs(value) < 0.2) return `${strength} 상관`;
  return `${strength} ${value > 0 ? "양의" : "음의"} 상관`;
}

function pearson(data, xKey, yKey) {
  const xMean = d3.mean(data, d => d[xKey]);
  const yMean = d3.mean(data, d => d[yKey]);
  const numerator = d3.sum(data, d => (d[xKey] - xMean) * (d[yKey] - yMean));
  const xSpread = d3.sum(data, d => (d[xKey] - xMean) ** 2);
  const ySpread = d3.sum(data, d => (d[yKey] - yMean) ** 2);
  return numerator / Math.sqrt(Math.max(xSpread * ySpread, Number.EPSILON));
}

function correlationSeries() {
  return d3.range(months.length).map(month => {
    const rows = state.selected ? [rowFor(byName.get(state.selected), month)] : allRows(month);
    return {
      month,
      period: months[month],
      trafficValue: d3.sum(rows, d => d.trafficValue),
      fireValue: d3.sum(rows, d => d.fireValue)
    };
  });
}

function renderCorrelation() {
  const data = correlationSeries();
  const value = pearson(data, "trafficValue", "fireValue");
  const regionName = state.selected || "전국";
  const direction = state.direction === "inflow" ? "유입" : "유출";
  document.querySelector("#corrRegion").textContent = regionName;
  document.querySelector("#corrValue").textContent = `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
  document.querySelector("#corrLabel").textContent = correlationLabel(value);

  const host = document.querySelector("#correlationChart");
  const width = Math.max(host.clientWidth, 520);
  const height = Math.max(host.clientHeight, 210);
  const margin = { top: 18, right: 28, bottom: 48, left: 56 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const x = d3.scaleLinear().domain([d3.min(data, d => d.trafficValue) * 0.9, d3.max(data, d => d.trafficValue) * 1.07]).nice().range([0, innerWidth]);
  const y = d3.scaleLinear().domain([0, d3.max(data, d => d.fireValue) * 1.16]).nice().range([innerHeight, 0]);
  const svg = d3.select(host).selectAll("svg").data([null]).join("svg").attr("viewBox", `0 0 ${width} ${height}`);
  svg.selectAll("*").remove();
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  g.append("g").attr("class", "chart-grid").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(6).tickSize(-innerHeight).tickFormat(""));
  g.append("g").attr("class", "chart-grid").call(d3.axisLeft(y).ticks(4).tickSize(-innerWidth).tickFormat(""));
  g.append("g").attr("class", "x-axis").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(6).tickFormat(d => d >= 1000000 ? `${(d / 1000000).toFixed(1)}M` : d >= 1000 ? `${Math.round(d / 1000)}k` : Math.round(d)));
  g.append("g").attr("class", "y-axis").call(d3.axisLeft(y).ticks(4));
  g.append("text").attr("class", "axis-title").attr("x", innerWidth / 2).attr("y", innerHeight + 42).attr("text-anchor", "middle").text(`월간 교통 ${direction}량`);
  g.append("text").attr("class", "axis-title").attr("transform", "rotate(-90)").attr("x", -innerHeight / 2).attr("y", -42).attr("text-anchor", "middle").text("산불 발생 건수");
  g.append("path").datum(data).attr("class", "correlation-line").attr("d", d3.line().x(d => x(d.trafficValue)).y(d => y(d.fireValue)));
  g.selectAll("circle").data(data).join("circle")
    .attr("class", d => `correlation-dot ${d.month === state.month ? "is-current" : ""}`)
    .attr("cx", d => x(d.trafficValue)).attr("cy", d => y(d.fireValue)).attr("r", d => d.month === state.month ? 7 : 5)
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", d => `${formatPeriod(d.period)}을 기준월로 선택`)
    .on("click", (_, d) => chooseMonth(d.month))
    .on("keydown", (event, d) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      chooseMonth(d.month);
    })
    .on("mousemove", (event, d) => showTooltip(event, `<b>${formatPeriod(d.period)}</b><span>${direction} 교통 ${formatTraffic(d.trafficValue)}</span><span>산불 ${Math.round(d.fireValue)}건</span>`))
    .on("mouseleave", hideTooltip);
  const labeled = data.filter(d => d.month === state.month || d.month % 3 === 0 || d.month === data.length - 1);
  g.selectAll(".month-point-label").data(labeled).join("text").attr("class", "month-point-label")
    .attr("x", d => x(d.trafficValue) + 7).attr("y", d => y(d.fireValue) - 7).text(d => d.period.slice(2).replace("-", "."));
}

function renderDetails() {
  const rows = allRows();
  let selected;
  if (state.selected) selected = rows.find(row => row.name === state.selected);
  else {
    selected = {
      name: "전국",
      trafficValue: d3.sum(rows, d => d.trafficValue),
      fireValue: d3.sum(rows, d => d.fireValue),
      areaValue: d3.sum(rows, d => d.areaValue)
    };
  }
  document.querySelector("#selectedRegionName").textContent = selected.name;
  document.querySelector("#trafficMetric").textContent = formatTraffic(selected.trafficValue);
  document.querySelector("#fireMetric").textContent = `${Math.round(selected.fireValue).toLocaleString("ko-KR")}건`;
  document.querySelector("#areaMetric").textContent = `${selected.areaValue.toFixed(1)}ha`;
  document.querySelector("#routePeriod").textContent = formatPeriod(months[state.month]);
  document.querySelector("#incidentCount").textContent = state.cause === "all"
    ? `총 ${Math.round(selected.fireValue)}건`
    : `${causeLabels[state.cause]} ${Math.round(selected.fireValue)}건`;

  let incoming = state.selected
    ? state.direction === "inflow"
      ? routeValues().filter(route => route.target === state.selected)
      : routeValues().filter(route => route.source === state.selected)
    : routeValues();
  incoming = incoming.sort((a, b) => b.value - a.value).slice(0, 4);
  const routeMax = d3.max(incoming, d => d.value) || 1;
  const routeList = d3.select("#routeList");
  routeList.selectAll(".route-item").data(incoming, d => `${d.source}-${d.target}-${d.mode}`).join(
    enter => {
      const item = enter.append("div").attr("class", "route-item");
      const meta = item.append("div").attr("class", "route-meta");
      meta.append("span").attr("class", "route-rank");
      meta.append("div").html('<b class="route-name"></b><span class="route-mode"></span>');
      item.append("strong").attr("class", "route-value");
      item.append("div").attr("class", "route-bar").append("span");
      return item;
    },
    update => update,
    exit => exit.remove()
  ).each(function(route, index) {
    const item = d3.select(this);
    item.select(".route-rank").text(String(index + 1).padStart(2, "0"));
    item.select(".route-name").text(`${shortName(route.source)} → ${shortName(route.target)}`);
    item.select(".route-mode").text(modeLabels[route.mode]);
    item.select(".route-value").text(formatTraffic(route.value));
    item.select(".route-bar span").style("width", `${(route.value / routeMax) * 100}%`).style("background", modeColors[route.mode]);
  });

  const periodIncidents = incidentsFor(months[state.month], state.selected);
  const causeData = causeKeys.map(key => {
    const rawValue = periodIncidents.filter(record => record.causeKey === key).length;
    return {
      key,
      label: causeLabels[key],
      value: state.cause === "all" || state.cause === key ? rawValue : 0
    };
  });
  const causeMax = d3.max(causeData, d => d.value) || 1;
  d3.select("#causeBars").selectAll(".cause-row").data(causeData, d => d.key).join(
    enter => {
      const row = enter.append("div").attr("class", "cause-row");
      const head = row.append("div").attr("class", "cause-head");
      head.append("span").attr("class", "cause-name");
      head.append("b").attr("class", "cause-value");
      row.append("div").attr("class", "cause-track").append("span");
      return row;
    },
    update => update,
    exit => exit.remove()
  ).each(function(cause) {
    const row = d3.select(this);
    row.classed("is-muted", state.cause !== "all" && state.cause !== cause.key)
      .classed("is-active", state.cause !== "all" && state.cause === cause.key);
    row.select(".cause-name").text(cause.label);
    row.select(".cause-value").text(`${Math.round(cause.value)}건`);
    row.select(".cause-track span").style("width", `${(cause.value / causeMax) * 100}%`);
  });
}

function observeResize() {
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(() => {
      renderMap();
      renderScatter();
      renderCorrelation();
    });
  });
  observer.observe(document.querySelector("#mapChart"));
  observer.observe(document.querySelector("#scatterChart"));
}

async function init() {
  setupEntryScreen();
  try {
    const [mapData, trafficData, fireData] = await Promise.all([
      d3.json("data/korea-provinces.json"),
      d3.json("data/traffic-records.json"),
      d3.json("data/fire-records.json")
    ]);
    geoData = mapData;
    trafficRecords = trafficData.records;
    const periodStart = new Date(`${trafficData.meta.periodStart}-01T00:00:00Z`);
    const periodEndExclusive = d3.utcMonth.offset(new Date(`${trafficData.meta.periodEnd}-01T00:00:00Z`), 1);
    months = d3.utcMonth.range(periodStart, periodEndExclusive).map(date => d3.utcFormat("%Y-%m")(date));
    fireRecords = fireData.records
      .filter(record => months.includes(record.period))
      .map(record => ({
        ...record,
        region: fireRegionAliases[record.locsi],
        causeKey: fireCauseKey(record.firecause)
      }))
      .filter(record => record.region);

    trafficByPeriod = d3.group(trafficRecords, record => record.period);
    fireByPeriodRegion = d3.group(fireRecords, record => record.period, record => record.region);
    state.month = Math.max(0, months.indexOf("2025-03"));

    const periodText = `${months[0].replace("-", ".")}—${months.at(-1).replace("-", ".")}`;
    document.querySelector("#dataStatus").textContent = `공공데이터 ${Number(trafficData.meta.recordCount + fireRecords.length).toLocaleString("ko-KR")}건`;
    document.querySelector("#dataPeriodLabel").textContent = periodText;
    document.querySelector("#periodEndLabel").textContent = formatPeriod(months.at(-1));
    document.querySelector(".prototype-note").innerHTML = `<strong>데이터 안내</strong> ${periodText} 공통 기간의 실제 기록만 사용했습니다. 교통은 시도 간 철도·고속·시외버스 월별 O/D ${trafficData.meta.recordCount.toLocaleString("ko-KR")}건, 산불은 발생기록 ${fireRecords.length.toLocaleString("ko-KR")}건입니다. 시도 내부 이동과 출·도착지 미상 교통은 유출·유입 분석에서 제외하며, 상관계수는 인과관계를 의미하지 않습니다.`;

    setupControls();
    renderAll();
    observeResize();
  } catch (error) {
    document.querySelector("#mapChart").innerHTML = '<p class="load-error">공공데이터를 불러오지 못했습니다. 페이지를 새로고침해 주세요.</p>';
    document.querySelector("#dataStatus").textContent = "데이터 로드 오류";
    document.querySelector("#dataPeriodLabel").textContent = "새로고침 필요";
    console.error(error);
  }
}

init();
