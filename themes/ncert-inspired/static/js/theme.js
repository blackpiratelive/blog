
    // Define a function that takes the name of the stylesheet file as a parameter
    function swapStyleSheet(sheet) {
        // Get the link element with id "pagestyle" and set its href attribute to the sheet parameter
        document.getElementById("pagestyle").setAttribute("href", sheet);
      }
  
      // Define a function that adds event listeners to the buttons
      function initate() {
        // Get the button elements with id "stylesheet1" and "stylesheet2"
        var style1 = document.getElementById("stylesheet1");
        var style2 = document.getElementById("stylesheet2");
  
        // Add a click event listener to style1 that calls swapStyleSheet with "default.css" as an argument
        style1.addEventListener("click", function() {
          swapStyleSheet("/css/style.css");
          setCookie("theme", "/css/style.css", 365);
        });
  
        // Add a click event listener to style2 that calls swapStyleSheet with "dark.css" as an argument
        style2.addEventListener("click", function() {
          swapStyleSheet("https://cdn.jsdelivr.net/npm/@exampledev/new.css@1.1.2/new.min.css");
          setCookie("theme", "https://cdn.jsdelivr.net/npm/@exampledev/new.css@1.1.2/new.min.css", 365);
        });
      }
  
      // Call the initate function when the window loads
      window.onload = initate;
  
  // function that can write cookie
  function setCookie(cname, cvalue, exdays) {
      var d = new Date();
    d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
    var expires = "expires="+d.toUTCString();
    document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
  }
  
  // function that can read cookie
  function getCookie(cname) {
      var name = cname + "=";
    var ca = document.cookie.split(';');
    for(var i = 0; i < ca.length; i++) {
      var c = ca[i];
      while (c.charAt(0) == ' ') {
        c = c.substring(1);
      }
      if (c.indexOf(name) == 0) {
        return c.substring(name.length, c.length);
      }
    }
    return "";
  }
  
  let chosenThemeValue = getCookie("theme");
  if (chosenThemeValue) {
      swapStyleSheet(chosenThemeValue);
  }