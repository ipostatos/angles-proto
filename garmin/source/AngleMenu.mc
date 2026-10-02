import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Full colored list: green = cut, red = skipped.
class AngleMenu extends WatchUi.CustomMenu {
    function initialize(p as Progress) {
        CustomMenu.initialize(80, Graphics.COLOR_BLACK, {:title => new MenuTitle("Angles")});
        var saw = "";
        for (var i = 0; i < p.entries.size(); i++) {
            var e = p.entries[i] as Array;
            if (!saw.equals(e[0])) {
                saw = e[0] as String;
                addItem(new HeaderItem(saw));
            }
            addItem(new AngleItem(p, i));
        }
    }
}

class AngleItem extends WatchUi.CustomMenuItem {
    var index as Number;
    hidden var _p as Progress;

    function initialize(p as Progress, i as Number) {
        CustomMenuItem.initialize(i, {});
        _p = p;
        index = i;
    }

    function draw(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var e = _p.entries[index] as Array;
        var bg = _p.color(index);
        dc.setColor(bg, bg);
        dc.fillRectangle(0, 2, w, h - 4);
        if (isFocused()) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(3);
            dc.drawRectangle(1, 2, w - 2, h - 4);
        }
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2 - 10, h / 2, Graphics.FONT_MEDIUM, formatValue(e[1] as Float) + "°",
            Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(w / 2 + 6, h / 2, Graphics.FONT_XTINY, e[2] as String,
            Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}

class HeaderItem extends WatchUi.CustomMenuItem {
    hidden var _label as String;

    function initialize(label as String) {
        CustomMenuItem.initialize(-1, {});
        _label = label;
    }

    function draw(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2, Graphics.FONT_SMALL, "- " + _label + " -",
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}

class MenuTitle extends WatchUi.Drawable {
    hidden var _text as String;

    function initialize(text as String) {
        Drawable.initialize({});
        _text = text;
    }

    function draw(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2, Graphics.FONT_SMALL, _text,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}

class AngleMenuDelegate extends WatchUi.Menu2InputDelegate {
    hidden var _p as Progress;

    function initialize(p as Progress) {
        Menu2InputDelegate.initialize();
        _p = p;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        if (item instanceof AngleItem) {
            _p.toggle(item.index);
            WatchUi.requestUpdate();
        }
    }
}
