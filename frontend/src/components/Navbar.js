import React, { useState, useEffect } from "react";
import logoPallavi from "../assets/logo-pallavi.png";
import logoDps from "../assets/logo-dps.png";

const navLinks = [
  {
    name: "Home",
    href: "#hero",
    id: "hero",
    icon: "M3 12l9-9 9 9 M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10",
  },
  {
    name: "About",
    href: "#about",
    id: "about",
    icon: "M12 22a10 10 0 100-20 10 10 0 000 20z M12 16v-5 M12 8h.01",
  },
  {
    name: "Openings",
    href: "#job-openings",
    id: "job-openings",
    icon: "M4 8h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z M8 8V6a2 2 0 012-2h4a2 2 0 012 2v2",
  },
  {
    name: "Benefits",
    href: "#staff-benefits",
    id: "staff-benefits",
    icon: "M20 12v10H4V12 M2 7h20v5H2z M12 22V7 M12 7c-1.5 0-4-.5-4-2.5S10.5 2 12 7z M12 7c1.5 0 4-.5 4-2.5S13.5 2 12 7z",
  },
];

const Navbar = ({ entity }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState("hero");

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);

      // Scroll spy: the section nearest above the navbar line wins,
      // regardless of the order links appear in the menu
      let current = "hero";
      let best = -Infinity;
      for (const link of navLinks) {
        const el = document.getElementById(link.id);
        if (el) {
          const top = el.getBoundingClientRect().top;
          if (top <= 140 && top > best) {
            best = top;
            current = link.id;
          }
        }
      }
      setActiveSection(current);
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (href) => {
    const element = document.querySelector(href);
    if (element) {
      const navbarHeight = 90;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - navbarHeight;
      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth"
      });
    }
  };

  const pillClass = isScrolled
    ? "bg-white/90 backdrop-blur-xl shadow-lg shadow-black/10 border-gray-200/70"
    : "bg-white/75 backdrop-blur-md shadow-md shadow-black/5 border-white/70";

  return (
    <>
      {/* Top bar */}
      <header className="fixed top-0 left-0 w-full z-50 px-3 sm:px-5 pt-3">
        <div className="max-w-[1400px] w-full mx-auto flex items-center justify-center md:justify-between gap-3">

          {/* Logo pill - centered on mobile, left on desktop */}
          <a
            href="#hero"
            onClick={(e) => { e.preventDefault(); scrollToSection('#hero'); }}
            className={`flex items-center gap-2.5 pl-4 pr-5 py-2 rounded-full border transition-all duration-300 ${pillClass}`}
          >
            {entity && entity.logo ? (
              <img
                src={entity.logo}
                alt={`${entity.name} Logo`}
                className="h-9 sm:h-10 w-auto max-w-[70vw] object-contain"
              />
            ) : entity ? (
              // An entity created in the admin panel ships no logo asset
              <span
                className="font-poppins text-base sm:text-lg font-semibold leading-none"
                style={{ color: entity.color || "#a81724" }}
              >
                {entity.name}
              </span>
            ) : (
              <>
                <img
                  src={logoPallavi}
                  alt="Pallavi Group of Schools Logo"
                  className="h-9 sm:h-10 w-auto"
                />
                <span className="w-px h-8 bg-gray-300"></span>
                <img
                  src={logoDps}
                  alt="Delhi Public School Logo"
                  className="h-9 sm:h-10 w-auto"
                />
              </>
            )}
          </a>

          {/* Nav pill (desktop only) */}
          <nav className={`hidden md:flex items-center gap-1 p-1.5 rounded-full border transition-all duration-300 ${pillClass}`}>
            {navLinks.map((link) => (
              <a
                key={link.name}
                href={link.href}
                onClick={(e) => { e.preventDefault(); scrollToSection(link.href); }}
                className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300 ${
                  activeSection === link.id
                    ? "bg-[rgb(30,58,138)] text-white shadow-md shadow-[rgb(30,58,138)]/25"
                    : "text-gray-700 hover:text-[rgb(30,58,138)] hover:bg-[rgb(30,58,138)]/5"
                }`}
              >
                {link.name}
              </a>
            ))}
          </nav>
        </div>
      </header>

      {/* Bottom dock (mobile only) */}
      <nav className="md:hidden fixed bottom-3 inset-x-3 z-50">
        <div className="mx-auto max-w-sm bg-white/90 backdrop-blur-xl border border-gray-200/70 shadow-xl shadow-black/15 rounded-3xl flex items-stretch justify-around px-1.5 py-1.5">
          {navLinks.map((link) => {
            const active = activeSection === link.id;
            return (
              <a
                key={link.name}
                href={link.href}
                onClick={(e) => { e.preventDefault(); scrollToSection(link.href); }}
                className={`flex flex-col items-center gap-0.5 flex-1 py-2 rounded-2xl transition-colors ${
                  active
                    ? "bg-[rgb(30,58,138)] text-white"
                    : "text-gray-500 active:bg-gray-100"
                }`}
              >
                <svg
                  className="w-[18px] h-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={link.icon} />
                </svg>
                <span className={`text-[10px] font-semibold ${active ? "text-white" : "text-gray-500"}`}>
                  {link.name}
                </span>
              </a>
            );
          })}
        </div>
      </nav>
    </>
  );
};

export default Navbar;
