import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Colored list of all angles: green = cut, red = skipped.
// START marks / unmarks the focused angle.
class AnglesView extends ScrollList {
    hidden var _p as Progress;
    hidden var _rows as Array = [];   // entry index, or saw name for a header

    function initialize(p as Progress) {
        ScrollList.initialize();
        _p = p;
        var saw = "";
        var first = p.firstOpen();
        for (var i = 0; i < p.entries.size(); i++) {
            var s = p.entries[i][0] as String;
            if (!saw.equals(s)) {
                saw = s;
                _rows.add(s);
            }
            if (i == first) {
                index = _rows.size();
            }
            _rows.add(i);
        }
    }

    function count() as Number {
        return _rows.size();
    }

    function drawRow(dc as Graphics.Dc, r as Number, y as Number, rowH as Number, focused as Boolean) as Void {
        var w = dc.getWidth();
        var cx = w / 2;
        var mid = y + rowH / 2;
        var row = _rows[r];
        if (row instanceof String) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, mid, Graphics.FONT_SMALL, "- " + row + " -", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            if (focused) {
                drawFocus(dc, y, rowH);
            }
            return;
        }
        var i = row as Number;
        var e = _p.entries[i] as Array;
        var bg = _p.color(i);
        if (bg != Graphics.COLOR_BLACK) {
            dc.setColor(bg, bg);
            dc.fillRoundedRectangle(w / 10, y + 3, w - w / 5, rowH - 6, 12);
        }
        if (focused) {
            drawFocus(dc, y, rowH);
        }
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx - 6, mid, Graphics.FONT_MEDIUM, formatValue(e[1] as Float) + "°", Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(cx + 8, mid, Graphics.FONT_XTINY, e[2] as String, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    function select() as Void {
        var row = _rows[index];
        if (row instanceof Number) {
            _p.toggle(row);
            WatchUi.requestUpdate();
        }
    }
}
