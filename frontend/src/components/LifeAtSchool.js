import React from "react";
import img1 from "../assets/teacher-benefits/sudha.webp";
import img2 from "../assets/teacher-benefits/cl-6.webp";
import img3 from "../assets/teacher-benefits/cl-12.webp";
import img4 from "../assets/teacher-benefits/cl-13.webp";
import img5 from "../assets/teacher-benefits/cl-4.webp";
import img6 from "../assets/teacher-benefits/lab.webp";
import img7 from "../assets/teacher-benefits/cl-1.webp";
import img8 from "../assets/teacher-benefits/cl-9.webp";
import img9 from "../assets/teacher-benefits/seminar.webp";
import img10 from "../assets/teacher-benefits/classroom.webp";

const images = [
  { src: img1, row: "row-span-2", label: "Learning Together" },
  { src: img2, row: "row-span-1", label: "Creativity" },
  { src: img3, row: "row-span-1", label: "Celebrations" },
  { src: img4, row: "row-span-2", label: "Campus Life" },
  { src: img5, row: "row-span-1", label: "Activities" },
  { src: img6, row: "row-span-2", label: "Growth" },
  { src: img7, row: "row-span-2", label: "Excellence" },
  { src: img10, row: "row-span-2", hideMobile: true, label: "Community" },
  { src: img8, row: "row-span-1", label: "Joy" },
  { src: img9, row: "row-span-1", label: "Memories" }
];

const LifeAtSchool = () => {
  return (
    <section
      className="py-12 sm:py-16 px-4 sm:px-6 bg-white"
      id="life-at-school"
    >
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10 md:mb-14">
          {/* Badge */}
          <span className="inline-block text-[#a81724] text-xs sm:text-sm font-semibold tracking-wider uppercase mb-2">
            Our Vibrant Community
          </span>

          {/* Title */}
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-[rgb(30,58,138)] font-poppins mb-4">
            Life at Our Schools
          </h2>

          <p className="text-gray-500 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
            A glimpse into the vibrant and diverse experiences of our students and staff family.
          </p>
        </div>

        {/* Collage Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4 auto-rows-[140px] md:auto-rows-[160px]">
          {images.map((item, index) => (
            <div
              key={index}
              className={`relative overflow-hidden rounded-xl ${item.row} group cursor-pointer ${item.hideMobile ? "hidden md:block" : ""
                }`}
              data-aos="zoom-in"
              data-aos-delay={index * 50}
            >
              {/* Image */}
              <img
                src={item.src}
                alt={item.label || `Life ${index + 1}`}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
              />

              {/* Gradient Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-[rgb(30,58,138)]/80 via-[rgb(30,58,138)]/30 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300"></div>

              {/* Label */}
              <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 transform translate-y-full group-hover:translate-y-0 transition-transform duration-300">
                <p className="text-white font-semibold text-xs sm:text-sm tracking-wide">
                  {item.label}
                </p>
                <div className="w-8 h-0.5 bg-[#a81724] mt-1 rounded-full"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default LifeAtSchool;
