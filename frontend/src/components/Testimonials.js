import React, { useState } from "react";
import avtar from "../assets/Emblem.png";

const testimonials = [
  {
    name: "Ms. Kavitha Reddy",
    position: "Pre-Primary Educator",
    message:
      "Being a part of the early childhood team has been so fulfilling. The curriculum is creative, and the support from the management keeps us motivated every day.",
    image: avtar,
  },
  {
    name: "Mr. Sandeep Kulkarni",
    position: "Middle School English Faculty",
    message:
      "Here I've found the perfect blend of academic excellence and personal growth. The students and staff make every day meaningful.",
    image: avtar,
  },
  {
    name: "Ms. Meenakshi Rao",
    position: "Secondary School Physics Teacher",
    message:
      "Teaching here has empowered me to innovate in the classroom. The environment fosters respect, excellence, and continuous improvement.",
    image: avtar,
  },
  {
    name: "Mr. Arvind Nair",
    position: "Administrative Officer",
    message:
      "The organization values every department. As an admin team member, I feel heard, appreciated, and proud to contribute to such a visionary institution.",
    image: avtar,
  }
];

const Testimonials = () => {
  const [active, setActive] = useState(0);

  return (
    <section className="relative py-16 sm:py-24 overflow-hidden" id="testimonials">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-amber-50/30"></div>
      
      {/* Decorative Elements */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-[rgb(30,58,138)]/5 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"></div>
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-amber-400/10 rounded-full blur-3xl translate-x-1/2 translate-y-1/2"></div>
      <div className="absolute top-1/2 left-1/4 w-64 h-64 bg-blue-200/20 rounded-full blur-2xl"></div>
      
      {/* Grid Pattern */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: `linear-gradient(rgb(30,58,138) 1px, transparent 1px), linear-gradient(90deg, rgb(30,58,138) 1px, transparent 1px)`,
        backgroundSize: '50px 50px'
      }}></div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-[rgb(30,58,138)]/5 backdrop-blur-sm border border-[rgb(30,58,138)]/10 rounded-full px-4 py-2 mb-6">
            <span className="w-2 h-2 bg-[#a81724] rounded-full animate-pulse"></span>
            <span className="text-[rgb(30,58,138)] text-sm font-medium">What Our Faculty Says</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[rgb(30,58,138)] font-poppins">
            Faculty Speak
          </h2>
        </div>

        {/* Main Content */}
        <div className="max-w-4xl mx-auto">
          
          {/* Featured Quote */}
          <div className="relative">
            {/* Floating Quote Mark */}
            <div className="absolute -top-8 -left-4 sm:-left-8 text-[120px] sm:text-[180px] font-serif text-[rgb(30,58,138)]/5 leading-none select-none">
              "
            </div>
            
            {/* Glass Card */}
            <div className="relative bg-white/80 backdrop-blur-md border border-gray-200 rounded-3xl p-6 sm:p-10 shadow-xl shadow-gray-200/50">
              {/* Quote */}
              <p className="text-gray-700 text-xl sm:text-2xl lg:text-3xl leading-relaxed font-light mb-10">
                {testimonials[active].message}
              </p>
              
              {/* Author Row */}
              <div className="flex items-center justify-between flex-wrap gap-6">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden">
                    <img
                      src={testimonials[active].image}
                      alt={testimonials[active].name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <h4 className="text-[rgb(30,58,138)] font-semibold text-lg">{testimonials[active].name}</h4>
                    <p className="text-[#a81724] text-sm">{testimonials[active].position}</p>
                  </div>
                </div>
                
                {/* Navigation Arrows */}
                <div className="flex gap-3">
                  <button
                    onClick={() => setActive((active - 1 + testimonials.length) % testimonials.length)}
                    className="w-12 h-12 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400 hover:bg-[rgb(30,58,138)] hover:text-white hover:border-[rgb(30,58,138)] transition-all"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setActive((active + 1) % testimonials.length)}
                    className="w-12 h-12 rounded-xl bg-[#a81724] flex items-center justify-center text-white hover:bg-[#8a1420] transition-all"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Thumbnail Cards (Hidden on mobile) */}
          <div className="hidden lg:flex justify-center gap-3 mt-8">
            {testimonials.map((t, idx) => (
              <button
                key={idx}
                onClick={() => setActive(idx)}
                className={`relative group p-3 rounded-xl text-left transition-all duration-300 ${
                  active === idx
                    ? "bg-[rgb(30,58,138)] shadow-lg shadow-[rgb(30,58,138)]/20"
                    : "bg-white border border-gray-200 hover:border-gray-300 hover:shadow-md"
                }`}
              >
                <div className="flex items-center gap-3">
                  <img
                    src={t.image}
                    alt={t.name}
                    className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <p className={`font-medium text-sm truncate ${
                      active === idx ? "text-white" : "text-[rgb(30,58,138)]"
                    }`}>
                      {t.name}
                    </p>
                    <p className={`text-xs truncate ${
                      active === idx ? "text-blue-200" : "text-gray-500"
                    }`}>
                      {t.position}
                    </p>
                  </div>
                </div>
                
                {/* Active Indicator */}
                {active === idx && (
                  <div className="absolute top-2 right-2 w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
