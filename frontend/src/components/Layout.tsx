import React, { type ReactNode } from 'react';
import {
  AppBar,
  Box,
  CssBaseline,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  Button,
  Avatar,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  Business as BusinessIcon,
  Assignment as AssignmentIcon,
  Assessment as AssessmentIcon,
  Logout as LogoutIcon,
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/**
 * Single source of truth for the sidebar width.
 *
 * Referenced by the app bar, nav container, drawer paper and main content so
 * they stay aligned; changing it in one place shifts the whole shell.
 */
const drawerWidth = 240;

/** Props for {@link Layout}. */
interface LayoutProps {
  /** The routed page rendered in the main content area. */
  children: ReactNode;
}

/**
 * App shell: fixed app bar, responsive navigation drawer and content area.
 *
 * Only rendered for authenticated users (the gate lives in `App`), which is why
 * it can read `user` from the auth context without a null-user fallback beyond
 * optional chaining. The signed-in email is shown in the bar because it is the
 * entire identity in this app — there is no display name — and it doubles as a
 * reminder of which tenant's data is on screen.
 *
 * @param props Component props.
 * @returns The shell with `children` in the main region.
 */
const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  // Navigation is data-driven so the drawer items and the app-bar title come
  // from one list: the title is looked up by matching the current pathname,
  // which keeps them from drifting apart when a route is added.
  const menuItems = [
    { text: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },
    { text: 'Clients', icon: <BusinessIcon />, path: '/clients' },
    { text: 'Work Entries', icon: <AssignmentIcon />, path: '/work-entries' },
    { text: 'Reports', icon: <AssessmentIcon />, path: '/reports' },
  ];

  // Extracted once and rendered into both drawers below, so the mobile and
  // desktop variants cannot diverge.
  const drawer = (
    <div>
      <Toolbar>
        <Typography variant="h6" noWrap component="div">
          Time Tracker
        </Typography>
      </Toolbar>
      <List>
        {menuItems.map((item) => (
          <ListItem key={item.text} disablePadding>
            <ListItemButton
              selected={location.pathname === item.path}
              onClick={() => navigate(item.path)}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </div>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <CssBaseline />
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
            {menuItems.find(item => item.path === location.pathname)?.text || 'Time Tracker'}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="body2">{user?.email}</Typography>
            <Avatar sx={{ width: 32, height: 32 }}>
              {user?.email?.charAt(0).toUpperCase()}
            </Avatar>
            <Button
              color="inherit"
              startIcon={<LogoutIcon />}
              onClick={logout}
              size="small"
            >
              Logout
            </Button>
          </Box>
        </Toolbar>
      </AppBar>
      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
        aria-label="mailbox folders"
      >
        {/*
          Two drawers rather than one responsive drawer: a temporary (overlay)
          one shown only on xs, and a permanent one from sm up. MUI has no
          single variant that switches, so visibility is driven by breakpoint
          `display` rules. `keepMounted` keeps the mobile drawer's DOM alive so
          it opens without a re-render cost and stays crawlable.
        */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true,
          }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: `calc(100% - ${drawerWidth}px)` },
        }}
      >
        {/*
          Spacer, not a second bar: the real app bar is `position: fixed` and
          therefore out of flow, so this empty toolbar reserves exactly its
          height and stops the page content from sliding underneath it.
        */}
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
};

export default Layout;
