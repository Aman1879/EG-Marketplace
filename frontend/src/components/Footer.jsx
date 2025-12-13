import { Link } from 'react-router-dom';
import './Footer.css';

const Footer = () => {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-content">
          <div className="footer-section">
            <h3>Shop</h3>
            <ul>
              <li><Link to="/products">All Products</Link></li>
              <li><Link to="/products?category=Jewellery">Jewellery</Link></li>
              <li><Link to="/products?category=Home">Home & Living</Link></li>
              <li><Link to="/products?category=Clothing">Clothing</Link></li>
            </ul>
          </div>
          
          <div className="footer-section">
            <h3>About</h3>
            <ul>
              <li><Link to="/our-story">Our Story</Link></li>
              <li><Link to="/">Careers</Link></li>
              <li><Link to="/">Press</Link></li>
              <li><Link to="/">Investors</Link></li>
            </ul>
          </div>
          
          <div className="footer-section">
            <h3>Help</h3>
            <ul>
              <li><Link to="/">Help Center</Link></li>
              <li><Link to="/">Privacy Settings</Link></li>
              <li><Link to="/contact">Contact Us</Link></li>
              <li><Link to="/disputes">Dispute Resolution</Link></li>
            </ul>
          </div>
          
          <div className="footer-section">
            <h3>Connect</h3>
            <ul>
              <li><Link to="/">Facebook</Link></li>
              <li><Link to="/">Instagram</Link></li>
              <li><Link to="/">Twitter</Link></li>
              <li><Link to="/">Pinterest</Link></li>
            </ul>
          </div>
        </div>
        
        <div className="footer-bottom">
          <p>&copy; 2025 Eg Marketplace. All rights reserved.</p>
          <div className="footer-links">
            <Link to="/">Terms of Use</Link>
            <Link to="/">Privacy Policy</Link>
            <Link to="/">Cookie Policy</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

