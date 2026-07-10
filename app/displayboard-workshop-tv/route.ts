import { NextResponse } from 'next/server';
import {
  WORKSHOP_DISPLAY_BOARD_BRAND,
  WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY,
  WORKSHOP_DISPLAY_BOARD_EMPTY_MAINTENANCE_LABEL,
  WORKSHOP_DISPLAY_BOARD_MAINTENANCE_TITLE,
  WORKSHOP_DISPLAY_BOARD_PAIRING_TOKEN_STORAGE_KEY,
  WORKSHOP_DISPLAY_BOARD_RIGHT_PANEL_SCROLL_SPEED_MULTIPLIER,
  WORKSHOP_DISPLAY_BOARD_STAT_TILES,
  WORKSHOP_DISPLAY_BOARD_TASK_PANELS,
  WORKSHOP_DISPLAY_BOARD_TEXT_SIZE_DEFAULT_STEP,
  WORKSHOP_DISPLAY_BOARD_TITLE,
  WORKSHOP_DISPLAY_BOARD_TOP_MAINTENANCE_LIMIT,
} from '@/lib/display-board/workshop-board-config';

export const dynamic = 'force-dynamic';

const legacyDisplayBoardConfig = {
  brand: WORKSHOP_DISPLAY_BOARD_BRAND,
  title: WORKSHOP_DISPLAY_BOARD_TITLE,
  maintenanceTitle: WORKSHOP_DISPLAY_BOARD_MAINTENANCE_TITLE,
  maintenanceEmptyLabel: WORKSHOP_DISPLAY_BOARD_EMPTY_MAINTENANCE_LABEL,
  deviceTokenStorageKey: WORKSHOP_DISPLAY_BOARD_DEVICE_TOKEN_STORAGE_KEY,
  pairingTokenStorageKey: WORKSHOP_DISPLAY_BOARD_PAIRING_TOKEN_STORAGE_KEY,
  rightPanelScrollSpeedMultiplier: WORKSHOP_DISPLAY_BOARD_RIGHT_PANEL_SCROLL_SPEED_MULTIPLIER,
  textSizeDefaultStep: WORKSHOP_DISPLAY_BOARD_TEXT_SIZE_DEFAULT_STEP,
  topMaintenanceLimit: WORKSHOP_DISPLAY_BOARD_TOP_MAINTENANCE_LIMIT,
  designWidth: 1920,
  designHeight: 1080,
  statTiles: WORKSHOP_DISPLAY_BOARD_STAT_TILES,
  taskPanels: WORKSHOP_DISPLAY_BOARD_TASK_PANELS,
};

const legacyDisplayBoardConfigJson = JSON.stringify(legacyDisplayBoardConfig);

const legacyDisplayBoardHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Workshop Display Board TV</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    html.tv-text-step-1 { font-size: 50%; }
    html.tv-text-step-2 { font-size: 75%; }
    html.tv-text-step-3 { font-size: 100%; }
    html.tv-text-step-4 { font-size: 150%; }
    html.tv-text-step-5 { font-size: 200%; }
    body {
      background: #020617;
      color: #fff;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 1.25rem;
    }
    .boot {
      position: absolute;
      top: 0;
      left: 0;
      width: 1920px;
      height: 1080px;
      padding: 80px;
      background: #020617;
      text-align: center;
      -webkit-transform-origin: 0 0;
      -ms-transform-origin: 0 0;
      transform-origin: 0 0;
    }
    .boot-card {
      width: 760px;
      max-width: 90%;
      margin: 12% auto 0;
      padding: 52px;
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 28px;
      background: rgba(255,255,255,0.055);
    }
    .boot h1 { margin: 0; font-size: 58px; line-height: 1.05; }
    .boot-message { margin-top: 28px; color: rgba(255,255,255,0.72); font-size: 28px; }
    .pair-code {
      margin: 36px auto 0;
      padding: 26px 28px;
      border: 1px solid rgba(180,99,68,0.65);
      border-radius: 24px;
      background: rgba(180,99,68,0.22);
      font-size: 78px;
      font-weight: 900;
      letter-spacing: 18px;
    }
    .muted { color: rgba(255,255,255,0.55); }
    .board {
      position: absolute;
      top: 0;
      left: 0;
      width: 1920px;
      height: 1080px;
      padding: 24px;
      background: #020617;
      background: -webkit-linear-gradient(315deg, #020617, #0f172a 48%, #111827);
      background: linear-gradient(135deg, #020617, #0f172a 48%, #111827);
      -webkit-transform-origin: 0 0;
      -ms-transform-origin: 0 0;
      transform-origin: 0 0;
    }
    .header {
      position: absolute;
      top: 24px;
      left: 24px;
      right: 24px;
      height: 108px;
      padding: 22px 28px;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 26px;
      background: rgba(255,255,255,0.06);
    }
    .brand { color: #f0b293; font-size: 1.0625rem; font-weight: 800; letter-spacing: 5px; text-transform: uppercase; }
    .title { margin-top: 3px; font-size: 2.6875rem; line-height: 1; font-weight: 900; }
    .status {
      position: absolute;
      top: 24px;
      right: 30px;
      text-align: right;
      color: rgba(255,255,255,0.7);
      font-size: 1.0625rem;
    }
    .status-top { white-space: nowrap; }
    .status-block {
      display: inline-block;
      margin-left: 22px;
      vertical-align: top;
    }
    .status-label {
      color: rgba(255,255,255,0.5);
      font-size: 0.875rem;
      font-weight: 800;
      letter-spacing: 0.22em;
      text-transform: uppercase;
    }
    .status strong { display: block; color: #fff; font-size: 1.75rem; }
    .live-badge {
      display: inline-block;
      margin-left: 22px;
      padding: 9px 16px;
      border: 1px solid rgba(74,222,128,0.3);
      border-radius: 999px;
      background: rgba(34,197,94,0.15);
      color: #dcfce7;
      font-size: 0.9375rem;
      font-weight: 800;
      vertical-align: top;
    }
    .status-meta {
      margin-top: 7px;
      color: rgba(255,255,255,0.45);
      font-size: 0.75rem;
    }
    .stats {
      position: absolute;
      top: 150px;
      left: 24px;
      right: 24px;
      display: table;
      table-layout: fixed;
      border-spacing: 12px 0;
      width: calc(100% - 48px);
    }
    .tile {
      display: table-cell;
      width: 14.285%;
      padding: 18px;
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 20px;
      background: rgba(255,255,255,0.07);
      vertical-align: top;
    }
    .tile-last { margin-right: 0; }
    .tile-label { color: rgba(255,255,255,0.68); font-size: 0.9375rem; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; }
    .tile-value { margin-top: 10px; font-size: 3.375rem; line-height: 1; font-weight: 900; }
    .tone-red { border-color: rgba(239,68,68,0.46); background: rgba(239,68,68,0.15); }
    .tone-amber { border-color: rgba(245,158,11,0.46); background: rgba(245,158,11,0.15); }
    .tone-blue { border-color: rgba(59,130,246,0.46); background: rgba(59,130,246,0.15); }
    .tone-purple { border-color: rgba(168,85,247,0.46); background: rgba(168,85,247,0.15); }
    .panel {
      position: absolute;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 26px;
      background: rgba(255,255,255,0.055);
      overflow: hidden;
    }
    .panel-maintenance {
      left: 24px;
      top: 312px;
      bottom: 24px;
      width: calc(33.333% - 23px);
    }
    .panel-pending {
      left: calc(33.333% + 21px);
      top: 312px;
      right: 24px;
      height: calc(33.333% - 120px);
      border-color: rgba(245,158,11,0.22);
    }
    .panel-progress {
      left: calc(33.333% + 21px);
      top: calc(33.333% + 204px);
      right: 24px;
      height: calc(33.333% - 120px);
      border-color: rgba(59,130,246,0.22);
    }
    .panel-hold {
      left: calc(33.333% + 21px);
      top: calc(66.666% + 96px);
      bottom: 24px;
      right: 24px;
      border-color: rgba(168,85,247,0.22);
    }
    .panel-title {
      margin: 0 0 10px;
      font-size: 1.0625rem;
      font-weight: 800;
      letter-spacing: 5px;
      line-height: 1.1;
      text-transform: uppercase;
    }
    .panel-title-maintenance { color: #fecaca; }
    .panel-title-amber { color: #fde68a; }
    .panel-title-blue { color: #bfdbfe; }
    .panel-title-purple { color: #ddd6fe; }
    .scroll-panel {
      position: absolute;
      top: 52px;
      right: 18px;
      bottom: 18px;
      left: 18px;
      overflow: hidden;
    }
    .scroll-panel.task-grid .row {
      display: inline-block;
      width: calc(50% - 6px);
      margin-right: 12px;
      vertical-align: top;
    }
    .scroll-panel.task-grid .row:nth-child(even) { margin-right: 0; }
    .row {
      min-height: 76px;
      margin-bottom: 12px;
      padding: 14px 16px;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      background: rgba(255,255,255,0.06);
      overflow: hidden;
    }
    .row-overdue { border-color: rgba(239,68,68,0.38); background: rgba(239,68,68,0.12); }
    .row-due { border-color: rgba(245,158,11,0.38); background: rgba(245,158,11,0.12); }
    .row-high-priority { border-color: rgba(239,68,68,0.42); background: rgba(239,68,68,0.14); }
    .row-progress { border-color: rgba(59,130,246,0.34); background: rgba(59,130,246,0.11); }
    .row-hold { border-color: rgba(168,85,247,0.34); background: rgba(168,85,247,0.11); }
    .row-main { float: left; width: 72%; }
    .row-title { font-size: 1.5625rem; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row-sub { margin-top: 5px; color: rgba(255,255,255,0.72); font-size: 1.125rem; line-height: 1.25; max-height: 46px; overflow: hidden; }
    .hp-badge {
      display: inline-block;
      margin-left: 7px;
      padding: 2px 6px;
      border: 1px solid rgba(248,113,113,0.5);
      border-radius: 999px;
      color: #fecaca;
      font-size: 0.6875rem;
      font-weight: 900;
      vertical-align: middle;
    }
    .tag {
      float: right;
      max-width: 26%;
      padding: 8px 10px;
      border: 1px solid rgba(255,255,255,0.24);
      border-radius: 12px;
      color: rgba(255,255,255,0.88);
      font-size: 1rem;
      font-weight: 800;
      text-align: right;
    }
    .empty {
      padding: 40px;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      color: rgba(255,255,255,0.55);
      text-align: center;
    }
    .text-step-1 .header {
      height: 70px;
      padding: 14px 22px;
    }
    .text-step-1 .status { top: 14px; }
    .text-step-1 .status-block { margin-left: 16px; }
    .text-step-1 .live-badge {
      margin-left: 16px;
      padding: 6px 12px;
    }
    .text-step-1 .status-meta { margin-top: 4px; }
    .text-step-1 .stats {
      top: 94px;
      border-spacing: 10px 0;
    }
    .text-step-1 .tile { padding: 12px; }
    .text-step-1 .tile-value { margin-top: 6px; }
    .text-step-1 .panel {
      padding: 14px;
      border-radius: 22px;
    }
    .text-step-1 .panel-maintenance { top: 178px; }
    .text-step-1 .panel-pending {
      top: 178px;
      height: 276px;
    }
    .text-step-1 .panel-progress {
      top: 470px;
      height: 276px;
    }
    .text-step-1 .panel-hold {
      top: 762px;
      bottom: 24px;
    }
    .text-step-1 .panel-title { margin: 0 0 6px; }
    .text-step-1 .scroll-panel {
      top: 32px;
      right: 14px;
      bottom: 14px;
      left: 14px;
    }
    .text-step-1 .row {
      min-height: 50px;
      margin-bottom: 8px;
      padding: 8px 12px;
      border-radius: 12px;
    }
    .text-step-1 .row-sub {
      margin-top: 3px;
      max-height: 28px;
    }
    .text-step-1 .tag {
      padding: 5px 8px;
      border-radius: 9px;
    }
    .text-step-2 .header {
      height: 88px;
      padding: 18px 24px;
    }
    .text-step-2 .status { top: 18px; }
    .text-step-2 .status-block { margin-left: 18px; }
    .text-step-2 .live-badge {
      margin-left: 18px;
      padding: 7px 13px;
    }
    .text-step-2 .status-meta { margin-top: 5px; }
    .text-step-2 .stats {
      top: 122px;
      border-spacing: 11px 0;
    }
    .text-step-2 .tile { padding: 14px; }
    .text-step-2 .tile-value { margin-top: 7px; }
    .text-step-2 .panel {
      padding: 16px;
      border-radius: 24px;
    }
    .text-step-2 .panel-maintenance { top: 226px; }
    .text-step-2 .panel-pending {
      top: 226px;
      height: 264px;
    }
    .text-step-2 .panel-progress {
      top: 506px;
      height: 264px;
    }
    .text-step-2 .panel-hold {
      top: 786px;
      bottom: 24px;
    }
    .text-step-2 .panel-title { margin: 0 0 8px; }
    .text-step-2 .scroll-panel {
      top: 40px;
      right: 16px;
      bottom: 16px;
      left: 16px;
    }
    .text-step-2 .row {
      min-height: 62px;
      margin-bottom: 10px;
      padding: 11px 14px;
      border-radius: 14px;
    }
    .text-step-2 .row-sub {
      margin-top: 4px;
      max-height: 36px;
    }
    .text-step-2 .tag {
      padding: 6px 9px;
      border-radius: 10px;
    }
  </style>
</head>
<body>
  <div id="app" class="boot">
    <div class="boot-card">
      <h1>Workshop Display Board</h1>
      <div class="boot-message">Loading display board...</div>
    </div>
  </div>
  <script>
    var BOARD_CONFIG = ${legacyDisplayBoardConfigJson};
    (function () {
      var DEVICE_TOKEN_STORAGE_KEY = BOARD_CONFIG.deviceTokenStorageKey;
      var PAIRING_TOKEN_STORAGE_KEY = BOARD_CONFIG.pairingTokenStorageKey;
      var app = document.getElementById('app');
      var refreshTimer = null;
      var scrollTimers = [];
      var clockTimer = null;

      function escapeHtml(value) {
        var text = value == null ? '' : String(value);
        return text.replace(/[&<>"']/g, function (character) {
          return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
          }[character];
        });
      }

      function storageGet(key) {
        try { return window.localStorage.getItem(key) || ''; } catch (error) { return ''; }
      }

      function storageSet(key, value) {
        try { window.localStorage.setItem(key, value); } catch (error) {}
      }

      function storageRemove(key) {
        try { window.localStorage.removeItem(key); } catch (error) {}
      }

      function requestJson(method, url, callback) {
        var xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.onreadystatechange = function () {
          var body;
          if (xhr.readyState !== 4) return;
          try {
            body = xhr.responseText ? JSON.parse(xhr.responseText) : {};
          } catch (error) {
            callback(new Error('The display board received an unreadable response.'), null, xhr.status);
            return;
          }
          callback(null, body, xhr.status);
        };
        xhr.onerror = function () {
          callback(new Error('The display board could not reach the server.'), null, xhr.status);
        };
        xhr.send(null);
      }

      function pad(value) {
        return value < 10 ? '0' + value : String(value);
      }

      function formatTime(value) {
        var date = value ? new Date(value) : new Date();
        if (isNaN(date.getTime())) return '--:--';
        return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
      }

      function formatDateTime(value) {
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        var date = value ? new Date(value) : null;
        if (!date || isNaN(date.getTime())) return 'Unknown';
        return pad(date.getDate()) + ' ' + months[date.getMonth()] + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
      }

      function setTextSizeClass(step) {
        var root = document.documentElement;
        root.className = (' ' + root.className + ' ')
          .replace(/ tv-text-step-[1-5] /g, ' ')
          .replace(/^\s+|\s+$/g, '');
        root.className = root.className ? root.className + ' tv-text-step-' + step : 'tv-text-step-' + step;
      }

      function getViewportSize() {
        return {
          width: window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth || BOARD_CONFIG.designWidth,
          height: window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight || BOARD_CONFIG.designHeight
        };
      }

      function scaleBoardToViewport() {
        var viewport = getViewportSize();
        var scale = Math.min(viewport.width / BOARD_CONFIG.designWidth, viewport.height / BOARD_CONFIG.designHeight);
        var left = Math.max(0, (viewport.width - (BOARD_CONFIG.designWidth * scale)) / 2);
        var top = Math.max(0, (viewport.height - (BOARD_CONFIG.designHeight * scale)) / 2);
        var transform = 'scale(' + scale + ')';

        if (!app || (app.className.indexOf('board') === -1 && app.className.indexOf('boot') === -1)) return;
        app.style.width = BOARD_CONFIG.designWidth + 'px';
        app.style.height = BOARD_CONFIG.designHeight + 'px';
        app.style.left = left + 'px';
        app.style.top = top + 'px';
        app.style.webkitTransform = transform;
        app.style.msTransform = transform;
        app.style.transform = transform;
      }

      function clearRefresh() {
        if (refreshTimer) window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }

      function stopAutoScroll() {
        var index;
        for (index = 0; index < scrollTimers.length; index += 1) {
          scrollTimers[index].cancelled = true;
          window.clearTimeout(scrollTimers[index].timeout);
          window.clearTimeout(scrollTimers[index].frame);
        }
        scrollTimers = [];
      }

      function startAutoScroll() {
        var panels = document.getElementsByClassName('scroll-panel');
        var index;
        stopAutoScroll();
        for (index = 0; index < panels.length; index += 1) {
          (function (panel) {
            var job = { timeout: null, frame: null, cancelled: false };
            var speedMultiplier = panel.getAttribute('data-speed') === 'fast'
              ? BOARD_CONFIG.rightPanelScrollSpeedMultiplier
              : 1;

            function schedule(callback, delayMs) {
              job.timeout = window.setTimeout(callback, delayMs);
            }

            function animateTo(target, done) {
              var start = panel.scrollTop;
              var distance = target - start;
              var duration = Math.max(1200, Math.min(12000 * speedMultiplier, Math.abs(distance) * 35 * speedMultiplier));
              var startTime = new Date().getTime();

              function tick() {
                var elapsed;
                var progress;
                if (job.cancelled) return;
                elapsed = new Date().getTime() - startTime;
                progress = Math.min(1, elapsed / duration);
                panel.scrollTop = start + (distance * progress);
                if (progress < 1) {
                  job.frame = window.setTimeout(tick, 16);
                  return;
                }
                done();
              }

              tick();
            }

            function loop() {
              var maxScroll;
              if (job.cancelled) return;
              maxScroll = panel.scrollHeight - panel.clientHeight;
              if (maxScroll <= 1) {
                panel.scrollTop = 0;
                schedule(loop, 2000);
                return;
              }
              schedule(function () {
                animateTo(maxScroll, function () {
                  schedule(function () {
                    animateTo(0, function () {
                      schedule(loop, 2000);
                    });
                  }, 2000);
                });
              }, 2000);
            }

            scrollTimers.push(job);
            loop();
          }(panels[index]));
        }
      }

      function updateClock() {
        var node = document.getElementById('board-now');
        if (node) node.innerHTML = escapeHtml(formatTime());
      }

      function startClock() {
        stopClock();
        updateClock();
        clockTimer = window.setInterval(updateClock, 1000);
      }

      function stopClock() {
        if (clockTimer) window.clearInterval(clockTimer);
        clockTimer = null;
      }

      function showBoot(message) {
        stopAutoScroll();
        stopClock();
        app.className = 'boot';
        scaleBoardToViewport();
        app.innerHTML = '<div class="boot-card"><h1>Workshop Display Board</h1><div class="boot-message">' + escapeHtml(message) + '</div></div>';
      }

      function showUnauthorised(message) {
        showBoot(message || 'This display board is not authorised.');
        schedulePairing(5000);
      }

      function showPairing(code, expiresAt) {
        stopAutoScroll();
        stopClock();
        app.className = 'boot';
        scaleBoardToViewport();
        app.innerHTML = '<div class="boot-card"><h1>Workshop Display Board</h1><div class="boot-message">Confirm this code in Admin Settings</div><div class="pair-code">' + escapeHtml(code) + '</div><p class="muted">Pairing expires at ' + escapeHtml(formatTime(expiresAt)) + '</p></div>';
        schedulePairing(3000);
      }

      function schedulePairing(delayMs) {
        clearRefresh();
        refreshTimer = window.setTimeout(tryJoinPairing, delayMs);
      }

      function scheduleBoardRefresh(delayMs) {
        clearRefresh();
        refreshTimer = window.setTimeout(loadBoard, delayMs);
      }

      function getTaskRowClass(item, panel) {
        if (item && item.is_high_priority) return 'row-high-priority';
        if (panel.tone === 'blue') return 'row-progress';
        if (panel.tone === 'purple') return 'row-hold';
        return 'row-due';
      }

      function getItemRow(item, rowClass, isTask) {
        var title = escapeHtml(item.asset);
        var html = '';
        if (isTask && item.is_high_priority) {
          title += '<span class="hp-badge">HP</span>';
        }
        html += '<div class="row ' + rowClass + '">';
        html += '<div class="row-main">';
        html += '<div class="row-title">' + title + '</div>';
        html += '<div class="row-sub">' + escapeHtml(isTask ? item.summary : item.category) + '</div>';
        html += '</div>';
        html += '<div class="tag">' + escapeHtml(isTask ? formatDateTime(item.created_at) : item.detail) + '</div>';
        html += '</div>';
        return html;
      }

      function getTaskItems(items, emptyLabel, panel) {
        var html = '';
        var item;
        var index;
        if (!items || items.length === 0) return '<div class="empty">' + escapeHtml(emptyLabel) + '</div>';
        for (index = 0; index < items.length; index += 1) {
          item = items[index];
          html += getItemRow(item, getTaskRowClass(item, panel), true);
        }
        return html;
      }

      function getMaintenanceRows(payload) {
        var rows = [];
        var html = '';
        var index;
        var overdue = payload.maintenance && payload.maintenance.overdue_items ? payload.maintenance.overdue_items : [];
        var dueSoon = payload.maintenance && payload.maintenance.due_soon_items ? payload.maintenance.due_soon_items : [];
        for (index = 0; index < overdue.length; index += 1) rows.push(overdue[index]);
        for (index = 0; index < dueSoon.length; index += 1) rows.push(dueSoon[index]);
        rows = rows.slice(0, BOARD_CONFIG.topMaintenanceLimit);
        if (rows.length === 0) return '<div class="empty">' + escapeHtml(BOARD_CONFIG.maintenanceEmptyLabel) + '</div>';
        for (index = 0; index < rows.length; index += 1) {
          html += getItemRow(rows[index], rows[index].status === 'due_soon' ? 'row-due' : 'row-overdue', false);
        }
        return html;
      }

      function getStatValue(definition, maintenanceTotals, workshopCounts) {
        var source = definition.source === 'maintenance' ? maintenanceTotals : workshopCounts;
        var value = source && source[definition.valueKey] ? source[definition.valueKey] : 0;
        return value;
      }

      function tile(definition, value, isLast) {
        return '<div class="tile tone-' + definition.tone + (isLast ? ' tile-last' : '') + '"><div class="tile-label">' + escapeHtml(definition.label) + '</div><div class="tile-value">' + escapeHtml(value) + '</div></div>';
      }

      function getPanelClass(panel) {
        if (panel.id === 'inProgress') return 'panel-progress';
        if (panel.id === 'onHold') return 'panel-hold';
        return 'panel-pending';
      }

      function getPanelTitleClass(panel) {
        if (panel.tone === 'blue') return 'panel-title-blue';
        if (panel.tone === 'purple') return 'panel-title-purple';
        return 'panel-title-amber';
      }

      function getPanelHtml(panel, payload) {
        var items = payload.workshop && payload.workshop[panel.itemsKey] ? payload.workshop[panel.itemsKey] : [];
        return '<div class="panel ' + getPanelClass(panel) + '"><div class="panel-title ' + getPanelTitleClass(panel) + '">' + escapeHtml(panel.title) + '</div><div class="scroll-panel task-grid" data-speed="fast">' + getTaskItems(items, panel.emptyLabel, panel) + '</div></div>';
      }

      function renderBoard(payload) {
        var maintenanceTotals = payload.maintenance && payload.maintenance.summary ? payload.maintenance.summary : {};
        var workshopCounts = payload.workshop && payload.workshop.counts ? payload.workshop.counts : {};
        var textSize = payload.display && payload.display.text_size_step ? Number(payload.display.text_size_step) : BOARD_CONFIG.textSizeDefaultStep;
        var pollSeconds = payload.config && payload.config.fallback_poll_interval_seconds ? Number(payload.config.fallback_poll_interval_seconds) : 60;
        var statsHtml = '';
        var panelsHtml = '';
        var index;
        if (textSize < 1 || textSize > 5) textSize = BOARD_CONFIG.textSizeDefaultStep;
        for (index = 0; index < BOARD_CONFIG.statTiles.length; index += 1) {
          statsHtml += tile(
            BOARD_CONFIG.statTiles[index],
            getStatValue(BOARD_CONFIG.statTiles[index], maintenanceTotals, workshopCounts),
            index === BOARD_CONFIG.statTiles.length - 1
          );
        }
        for (index = 0; index < BOARD_CONFIG.taskPanels.length; index += 1) {
          panelsHtml += getPanelHtml(BOARD_CONFIG.taskPanels[index], payload);
        }
        setTextSizeClass(textSize);
        app.className = 'board text-step-' + textSize;
        scaleBoardToViewport();
        app.innerHTML =
          '<div class="header"><div class="brand">' + escapeHtml(BOARD_CONFIG.brand) + '</div><div class="title">' + escapeHtml(BOARD_CONFIG.title) + '</div><div class="status"><div class="status-top"><div class="status-block"><div class="status-label">Last update</div><strong>' + escapeHtml(formatTime(payload.generated_at)) + '</strong></div><div class="status-block"><div class="status-label">Now</div><strong id="board-now">' + escapeHtml(formatTime()) + '</strong></div><div class="live-badge">Live</div></div><div class="status-meta">Fallback refresh every ' + escapeHtml(pollSeconds) + 's · Polling mode</div></div></div>' +
          '<div class="stats">' +
            statsHtml +
          '</div>' +
          '<div class="panel panel-maintenance"><div class="panel-title panel-title-maintenance">' + escapeHtml(BOARD_CONFIG.maintenanceTitle) + '</div><div class="scroll-panel">' + getMaintenanceRows(payload) + '</div></div>' +
          panelsHtml;
        startClock();
        startAutoScroll();
        scheduleBoardRefresh(Math.max(15, pollSeconds) * 1000);
      }

      function loadBoard() {
        var deviceToken = storageGet(DEVICE_TOKEN_STORAGE_KEY);
        if (!deviceToken) {
          tryJoinPairing();
          return;
        }

        requestJson('GET', '/api/display-board/workshop/data?device_token=' + encodeURIComponent(deviceToken) + '&_=' + Date.now(), function (error, body, status) {
          if (error) {
            showBoot(error.message);
            scheduleBoardRefresh(15000);
            return;
          }
          if (status === 401) {
            storageRemove(DEVICE_TOKEN_STORAGE_KEY);
            showUnauthorised(body && body.error ? body.error : 'This display board is not authorised.');
            return;
          }
          if (!body || body.status !== 'ok' || !body.payload) {
            showBoot(body && body.error ? body.error : 'Unable to load display board data.');
            scheduleBoardRefresh(15000);
            return;
          }
          renderBoard(body.payload);
        });
      }

      function refreshVisibleBoard() {
        if (!document.visibilityState || document.visibilityState === 'visible') {
          loadBoard();
        }
      }

      function startPairing() {
        requestJson('POST', '/api/display-board/workshop/pairing?_=' + Date.now(), function (error, body) {
          if (error) {
            showUnauthorised(error.message);
            return;
          }
          if (body && body.status === 'pairing' && body.confirmation_code && body.expires_at) {
            if (body.pairing_token) storageSet(PAIRING_TOKEN_STORAGE_KEY, body.pairing_token);
            showPairing(body.confirmation_code, body.expires_at);
            return;
          }
          showUnauthorised(body && body.message ? body.message : 'This display board is not authorised.');
        });
      }

      function tryJoinPairing() {
        var deviceToken = storageGet(DEVICE_TOKEN_STORAGE_KEY);
        var pairingToken;
        if (deviceToken) {
          loadBoard();
          return;
        }

        pairingToken = storageGet(PAIRING_TOKEN_STORAGE_KEY);
        if (!pairingToken) {
          startPairing();
          return;
        }

        requestJson('GET', '/api/display-board/workshop/pairing?pairing_token=' + encodeURIComponent(pairingToken) + '&_=' + Date.now(), function (error, body) {
          if (error) {
            showUnauthorised(error.message);
            return;
          }
          if (body && body.status === 'paired' && body.device_token) {
            storageSet(DEVICE_TOKEN_STORAGE_KEY, body.device_token);
            storageRemove(PAIRING_TOKEN_STORAGE_KEY);
            loadBoard();
            return;
          }
          if (body && body.status === 'pairing' && body.confirmation_code && body.expires_at) {
            showPairing(body.confirmation_code, body.expires_at);
            return;
          }
          storageRemove(PAIRING_TOKEN_STORAGE_KEY);
          startPairing();
        });
      }

      showBoot('Loading display board...');
      if (document.addEventListener) {
        document.addEventListener('visibilitychange', refreshVisibleBoard);
      }
      if (window.addEventListener) {
        window.addEventListener('resize', scaleBoardToViewport);
      } else {
        window.onresize = scaleBoardToViewport;
      }
      tryJoinPairing();
    }());
  </script>
</body>
</html>`;

export function GET() {
  return new NextResponse(legacyDisplayBoardHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
