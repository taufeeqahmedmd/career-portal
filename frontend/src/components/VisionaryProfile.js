import React from "react";
import komanPhoto from "../assets/koman.jpg";

const VisionaryProfile = () => {
  return (
    <section className="relative py-16 sm:py-24 overflow-hidden" id="visionary">
      {/* Background - warm ivory, distinct from neighbouring sections */}
      <div className="absolute inset-0 bg-[#faf8f4]"></div>
      <div className="absolute top-0 left-1/3 w-96 h-96 bg-amber-200/20 rounded-full blur-3xl"></div>
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-[rgb(30,58,138)]/5 rounded-full blur-3xl translate-x-1/3 translate-y-1/3"></div>

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-16 items-center">

          {/* Left - Arch portrait */}
          <div className="lg:col-span-4" data-aos="fade-right">
            <div className="relative max-w-[300px] sm:max-w-[330px] mx-auto">
              {/* Offset thin outline echoing the arch */}
              <div className="absolute inset-0 translate-x-3 -translate-y-3 rounded-t-[10rem] rounded-b-[1.5rem] border border-[#a81724]/25"></div>

              <div className="relative aspect-[4/5] rounded-t-[10rem] rounded-b-[1.5rem] overflow-hidden shadow-xl shadow-amber-900/10">
                <img
                  src={komanPhoto}
                  alt="M Komaraiah, the person behind our schools"
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Quiet caption under the portrait */}
              <p className="text-center text-gray-400 text-sm italic mt-5 tracking-wide">
                Guiding our schools for over three decades
              </p>
            </div>
          </div>

          {/* Right - Writeup */}
          <div className="lg:col-span-8" data-aos="fade-left">
            {/* Eyebrow */}
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-px bg-[#a81724]"></div>
              <span className="text-[#a81724] text-xs font-semibold tracking-[0.25em] uppercase">The Guiding Force</span>
            </div>

            <h2 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold text-[rgb(30,58,138)] font-poppins leading-[1.15] mb-6">
              The Person Behind Our Schools
            </h2>

            {/* Lead line */}
            <p className="text-lg sm:text-xl text-gray-500 italic font-light leading-relaxed mb-7 max-w-2xl">
              A life dedicated to uplifting children through transformative
              learning experiences.
            </p>

            {/* Name plate */}
            <div className="flex items-center gap-4 mb-7">
              <div>
                <p className="text-lg sm:text-xl font-semibold text-gray-900 tracking-[0.08em] uppercase font-poppins">
                  M&nbsp;Komaraiah
                </p>
                <p className="text-gray-400 text-sm mt-1 tracking-wide">
                  B-Tech (Civil)
                  <span className="text-[#a81724] mx-2">✦</span>
                  Pro Vice Chairman
                </p>
              </div>
              <div className="flex-1 h-px bg-gradient-to-r from-gray-300 to-transparent"></div>
            </div>

            {/* Writeup with drop cap */}
            <div className="space-y-5 mb-8 max-w-2xl">
              <p className="dropcap text-gray-600 text-base sm:text-[1.05rem] leading-[1.85]">
                Malka Komaraiah, a visionary leader with over 30 years of experience in
                the education sector, has dedicated his life to uplifting children through
                transformative learning experiences. He has been instrumental in shaping
                these institutions into centers of excellence — his vision and dedicated
                service have enabled our schools to enter a new era in education.
              </p>
              <p className="text-gray-600 text-base sm:text-[1.05rem] leading-[1.85]">
                He is renowned for integrating technology, education, and research to
                build exemplary institutions that prepare capable students to meet the
                challenges of the modern global scenario. Under his leadership, our
                schools have achieved remarkable growth, setting benchmarks in academics,
                infrastructure, and student development.
              </p>
            </div>

            {/* Quiet closing line */}
            <div className="flex items-center gap-3 text-gray-400 text-sm tracking-wide">
              <span>Technology-driven learning</span>
              <span className="text-[#a81724] text-[10px]">✦</span>
              <span>Centers of excellence</span>
              <span className="text-[#a81724] text-[10px]">✦</span>
              <span>Student-first vision</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default VisionaryProfile;
