import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Full-screen list drawn by the app itself (system menus add a round
// subscreen in the corner on Instinct 3). The focused row sits in the middle.
// UP/DOWN move, START selects.
class ScrollList extends WatchUi.View {
    var index as Number = 0;
    const VISIBLE = 5;

    function initialize() {
        View.initialize();
    }

    function count() as Number {
        return 0;
    }

    function drawRow(dc as Graphics.Dc, i as Number, y as Number, rowH as Number, focused as Boolean) as Void {
    }

    function select() as Void {
    }

    function move(step as Number) as Void {
        var n = index + step;
        if (n >= 0 && n < count()) {
            index = n;
            WatchUi.requestUpdate();
        }
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var h = dc.getHeight();
        var rowH = h / VISIBLE;
        var half = VISIBLE / 2;
        for (var k = -half; k <= half; k++) {
            var i = index + k;
            if (i >= 0 && i < count()) {
                drawRow(dc, i, h / 2 + k * rowH - rowH / 2, rowH, k == 0);
            }
        }
    }

    // Rounded focus frame across the row.
    function drawFocus(dc as Graphics.Dc, y as Number, rowH as Number) as Void {
        var w = dc.getWidth();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(3);
        dc.drawRoundedRectangle(w / 10, y + 3, w - w / 5, rowH - 6, 12);
    }
}

class ScrollDelegate extends WatchUi.BehaviorDelegate {
    hidden var _v as ScrollList;

    function initialize(v as ScrollList) {
        BehaviorDelegate.initialize();
        _v = v;
    }

    function onNextPage() as Boolean {
        _v.move(1);
        return true;
    }

    function onPreviousPage() as Boolean {
        _v.move(-1);
        return true;
    }

    function onSelect() as Boolean {
        _v.select();
        return true;
    }
}
