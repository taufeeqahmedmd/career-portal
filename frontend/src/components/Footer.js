import React from "react";

const Footer = ({ entity }) => {
  const owner = entity ? entity.name : "Delhi Public Schools & Pallavi Group of Schools";
  return (
    <footer className="bg-[rgb(30,58,138)] pt-4 pb-24 md:py-4 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
          <p className="text-white/70 text-xs sm:text-sm">
            © {new Date().getFullYear()} {owner}. All Rights Reserved.
          </p>
          <p className="text-white/50 text-xs">
            Design & Developed by{" "}
            <a
              href="https://k-innovative.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/70 font-medium hover:text-white underline-offset-2 hover:underline transition-colors"
            >
              K-Innovative Hub Pvt. Ltd
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
