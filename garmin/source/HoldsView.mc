import Toybox.Application.Storage;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Start screen: actions on top, then every hold with a checkbox.
// Picks are saved on each change.
const ACTIONS = ["BIG MODE", "LIST", "RESET PROGRESS", "RESET HOLDS", "FROM PHONE"];
const A_BIG = 0;
const A_LIST = 1;
const A_RESET = 2;
const A_RESET_HOLDS = 3;
const A_SYNC = 4;

class HoldsView extends ScrollList {
    hidden var _catalog as Array;
    hidden var _picked as Array;
    hidden var _subs as Array;

    function initialize(catalog as Array) {
        ScrollList.initialize();
        _catalog = catalog;
        var p = Storage.getValue("picked");
        _picked = p instanceof Array ? p : [];
        _subs = [null, null, "clear cut marks", "untick all holds", "get holds sent from site"];
    }

    function onShow() as Void {
        gHoldsView = self;
    }

    function onHide() as Void {
        if (gHoldsView == self) {
            gHoldsView = null;
        }
    }

    function count() as Number {
        return ACTIONS.size() + _catalog.size();
    }

    function drawRow(dc as Graphics.Dc, i as Number, y as Number, rowH as Number, focused as Boolean) as Void {
        var cx = dc.getWidth() / 2;
        var mid = y + rowH / 2;
        if (focused) {
            drawFocus(dc, y, rowH);
        }
        if (i < ACTIONS.size()) {
            var sub = i == A_BIG ? _picked.size() + " selected" : _subs[i];
            dc.setColor(i == A_BIG ? 0x00C040 : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            if (sub == null) {
                dc.drawText(cx, mid, (i == A_BIG ? Graphics.FONT_SMALL : Graphics.FONT_TINY), ACTIONS[i], Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            } else {
                dc.drawText(cx, mid - rowH / 6, (i == A_BIG ? Graphics.FONT_SMALL : Graphics.FONT_TINY), ACTIONS[i], Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
                dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, mid + rowH / 4, Graphics.FONT_XTINY, sub as String, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            }
            return;
        }
        var name = (_catalog[i - ACTIONS.size()] as Array)[0] as String;
        var on = _picked.indexOf(name) >= 0;
        var font = Graphics.FONT_SMALL;
        var tw = dc.getTextWidthInPixels(name, font);
        var box = rowH / 3;
        var gap = box / 2;
        var x = cx - (tw + box + gap) / 2;
        dc.setColor(on ? 0x00C040 : Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(2);
        if (on) {
            dc.fillRoundedRectangle(x, mid - box / 2, box, box, 4);
        } else {
            dc.drawRoundedRectangle(x, mid - box / 2, box, box, 4);
        }
        dc.setColor(on ? Graphics.COLOR_WHITE : Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x + box + gap, mid, font, name, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    function select() as Void {
        if (index >= ACTIONS.size()) {
            var name = (_catalog[index - ACTIONS.size()] as Array)[0] as String;
            if (_picked.indexOf(name) >= 0) {
                _picked.remove(name);
            } else {
                _picked.add(name);
            }
            Storage.setValue("picked", _picked);
            WatchUi.requestUpdate();
            return;
        }
        if (index == A_RESET || index == A_RESET_HOLDS) {
            var q = index == A_RESET ? "Reset progress?" : "Untick all holds?";
            WatchUi.pushView(new WatchUi.Confirmation(q), new ResetConfirm(self, index), WatchUi.SLIDE_IMMEDIATE);
            return;
        }
        if (index == A_SYNC) {
            setSyncStatus("loading...");
            syncFromPhone();
            return;
        }
        var rows = pickedRows();
        if (rows.size() == 0) {
            return;
        }
        var p = new Progress(rows);
        if (index == A_BIG) {
            var b = new BigView(p);
            WatchUi.pushView(b, new BigDelegate(b, p), WatchUi.SLIDE_LEFT);
        } else {
            var l = new AnglesView(p);
            WatchUi.pushView(l, new ScrollDelegate(l), WatchUi.SLIDE_LEFT);
        }
    }

    // Picked holds in catalog order.
    hidden function pickedRows() as Array {
        var rows = [];
        for (var i = 0; i < _catalog.size(); i++) {
            var row = _catalog[i] as Array;
            if (_picked.indexOf(row[0]) >= 0) {
                rows.add(row);
            }
        }
        return rows;
    }

    function setSyncStatus(text as String) as Void {
        _subs[A_SYNC] = text;
        WatchUi.requestUpdate();
    }

    function doReset(which as Number) as Void {
        if (which == A_RESET_HOLDS) {
            _picked = [];
            Storage.setValue("picked", _picked);
        } else {
            clearProgress();
            _subs[A_RESET] = "cleared";
        }
        WatchUi.requestUpdate();
    }
}

// Resets run only after "Yes", so a stray press cannot wipe anything.
class ResetConfirm extends WatchUi.ConfirmationDelegate {
    hidden var _v as HoldsView;
    hidden var _which as Number;

    function initialize(v as HoldsView, which as Number) {
        ConfirmationDelegate.initialize();
        _v = v;
        _which = which;
    }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        if (response == WatchUi.CONFIRM_YES) {
            _v.doReset(_which);
        }
        return true;
    }
}
