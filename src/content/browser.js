var commandManager = new CommandManager();
function manageMenuItemClicked() {
   window.openDialog("chrome://greasemonkey/content/manage.xul", "manager", 
     "resizable,centerscreen,modal");
 }

 function installMenuItemClicked() {
   new ScriptDownloader(window._content.location.href).start();
 }

 function installContextItemClicked() {
   new ScriptDownloader(document.popupNode.href).start();
 }

 function contextMenuShowing() {
   var culprit = document.popupNode;
   var contextItem = ge("install-userscript");
   var contextSep = ge("install-userscript-sep");

   contextItem.hidden = contextSep.hidden = 
     !(culprit.tagName.toLowerCase() == "a" 
     && culprit.href.match(/\.user\.js(\?|$)/i) != null);
 }

 function toolsMenuShowing(e) {
   var installItems = ge_multi("userscript-tools-install", "menuitem");
   var commandsItems = ge_multi("userscript-commands", "menu");
   var disabled = !(window._content && window._content.location && 
   window._content.location.href.match(/\.user\.js(\?|$)/i) != null);

   for( var i = 0; i < installItems.length; i++ ) {
     installItems[i].setAttribute("disabled", disabled.toString());
   }
   for( var i = 0; i < commandsItems.length; i++ ) {
     commandManager.initToolsMenu(commandsItems[i]);
   }
 }

 function installContextItemClicked() {
   new ScriptDownloader(document.popupNode.href).start();
 }



window.addEventListener("load", function() {
  var appcontent = ge("appcontent");
  var prefManager = new GM_PrefManager();
  var gmEnabled = true;

  GM_updateVersion(prefManager);
  
  if (appcontent){
    if (!appcontent.greased){
      appcontent.greased = true;
      appcontent.addEventListener("DOMContentLoaded", greaseLoad, false);

      var statusImage = ge("gm-status-image");
      
      prefManager.watch("enabled", refreshStatus);
      refreshStatus();

      statusImage.addEventListener("mousedown", statusImageClicked, false);
    }
  }

  function greaseLoad(e) {
    if (!gmEnabled) {
      return;
    }
    
    var win = e.explicitOriginalTarget.defaultView;
    var doc = win.document;

    if(!doc.body) {
      return;
    }

    initGMXmlHttp(win);

    commandManager.loadDoc(e);
    window._content.addEventListener("unload", commandManager.unloadDoc, false);

    ge("contentAreaContextMenu").addEventListener("popupshowing", contextMenuShowing, false);
    // firefox case
    var tools = ge_multi("menu_ToolsPopup", "menupopup");
    for( var i = 0; i < tools.length; i++ ) {
      tools[i].addEventListener("popupshowing", toolsMenuShowing, false);
    }
    // Seamonkey case
    tools = ge_multi("taskPopup", "menupopup");
    for( var i = 0; i < tools.length; i++ ) {
      tools[i].addEventListener("popupshowing", toolsMenuShowing, false);
    }

    var config = new Config();
    var scriptElm;

    config.load();
    
    outer:
    for (var i = 0; i < config.scripts.length; i++) {
      var script = config.scripts[i];

      if (script.enabled) {
        for (var j = 0; j < script.includes.length; j++) {
          var pattern = convert2RegExp(script.includes[j]);

          if (pattern.test(e.originalTarget.location.href)) {
            for (var k = 0; k < script.excludes.length; k++) {
              pattern = convert2RegExp(script.excludes[k]);
      
              if (pattern.test(e.originalTarget.location.href)) {
                continue outer;
              }
            }

            injectScript(script, win, doc);                    

            continue outer;
          }
        }
      }
    }

    // need to undo these here because if any of the scripts load
    // external scripts, then they will get run asynchronously, which
    // means that this will run before them, which means that they
    // will get null references when trying to use these functions.
    runBrowserScript(
      doc,
      ["delete window.GM_xmlhttpRequest;", 
       "delete window.GM_registerMenuCommand;",
       "delete window.GM_setValue;",
       "delete window.GM_getValue;",
       "delete window.GM_log;"].join("\n")
    );
  }
  
  function injectScript(script, win, doc) {
    var prefMan = new GM_PrefManager("scriptvals." + script.namespace + "/" + script.name + ".");
    
    win.GM_setValue = function(name, value) {
      prefMan.setValue(name, value);
    }
    win.GM_getValue = function(name, defaultValue) {
      return prefMan.getValue(name, defaultValue);
    }
    win.GM_log = function(message, level) {
      GM_log([script.namespace, "/", script.name, ": ", message].join(""), level)
    }

    try {
      runBrowserScript(
        doc,
        [ "(function(){",
          "var GM_xmlhttpRequest = window.GM_xmlhttpRequest;",
          "var GM_registerMenuCommand = window.GM_registerMenuCommand;",
          "var GM_setValue = window.GM_setValue;",
          "var GM_getValue = window.GM_getValue;",
          "var GM_log = window.GM_log;\n",
          getContents(getScriptChrome(script.filename)),
          "})();"
          ].join("\n")
      );
    } catch (ex) {
      GM_log([scriptLogPrefix(script), "Exception when injecting : ", uneval(ex)].join(""));
    }
  }
  
  function scriptLogPrefix(script) {
    return [script.namespace, "/", script.name, ": "].join("");
  }

  function runBrowserScript(doc, jscode) {
    if(doc && doc.body) {
      var elm = doc.createElement("script");
      elm.appendChild(doc.createTextNode(jscode));
      doc.body.appendChild(elm);
      doc.body.removeChild(elm);
    }
  }
  
  function initGMXmlHttp(browser) {
    // details should look like: 
    // {method,url,onload,onerror,onreadystatechange,headers,data}
    // headers should be in the form [{name:value},{name:value},etc]
    // can't support mimetype because i think it's only used for forcing
    // text/xml and we can't support that
    browser.GM_xmlhttpRequest = function(details) {

      // don't actually need the timer functionality, but this pops it 
      // out into chromeWindow's thread so that we get that security 
      // context.
      window.setTimeout(function(){ startRequest(details) }, 0);
    }
    
    function startRequest(details) {
      var req = new XMLHttpRequest();

      setupRequestEvent(req, "onload", details);
      setupRequestEvent(req, "onreadystatechange", details);
      setupRequestEvent(req, "onerror", details);

      req.open(details.method, details.url);
      
      if (details.headers) {
        for (var prop in details.headers) {
          req.setRequestHeader(prop, details.headers[prop]);
        }
      }
      
      req.send(details.data);
    }

    function setupRequestEvent(req, event, details) {
      if (details[event]) {              
        req[event] = function() {
        var responseState = {
            // can't support responseXML because security won't
            // let the browser call properties on it
            responseText:req.responseText,
            readyState:req.readyState,
            responseHeaders:(req.readyState == 4 ? req.getAllResponseHeaders() : ''),
            status:(req.readyState == 4 ? req.status : 0),
            statusText:(req.readyState == 4 ? req.statusText : '')
          }
          
          // pop back onto browser thread and call event handler                    
          browser.setTimeout(function(){ 
            details[event](responseState)
          }, 0);
        }
      }
    }
  }

  function refreshStatus() {
    gmEnabled = prefManager.getValue("enabled", true);

    if (gmEnabled) {
      statusImage.src = "chrome://greasemonkey/content/status_on.gif";
      statusImage.tooltipText = "Greasemonkey is enabled";
    }
    else {
      statusImage.src = "chrome://greasemonkey/content/status_off.gif";
      statusImage.tooltipText = "Greasemonkey is disabled";
    }
  }

  function statusImageClicked() {
    prefManager.setValue("enabled", !gmEnabled);
  }

  function parseArgs(href) {
    var qsStartPos = href.lastIndexOf("?");
    var vargs = {};

    if (qsStartPos > -1) {
      var qs = href.substring(qsStartPos + 1);
      var args = qs.split("&");
      var nv;

      for (var i = 0, arg = null; (arg = args[i]); i++) {
        nv = arg.split("=");
        vargs[nv[0]] = unescape(nv[1]);
      }
    }

    return vargs;
  }
}, false); // end window.addEventListener("load"...)
